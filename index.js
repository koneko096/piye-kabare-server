var app = require("express")();
var express = require("express");
var _ = require("lodash");
var amqp = require("amqplib/callback_api");
var http = require("http").createServer(app);
var io = require("socket.io")(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"],
  },
});

require("dotenv").config();

// Services
var userService = require("./services/userService");
var roomService = require("./services/roomService");
var chatService = require("./services/chatService");
var roomuserQ = require("./queries/roomuser");
var roomQ = require("./queries/room");
var configAMQP = require("./config/amqp.js");

// Global AMQP variables
let amqpChannel = null;
let amqpConnection = null;

const AMQP_EXCHANGE = "chat_exchange";
const SYSTEM_ROOM_ID = "1";
const queueGroupBindings = new Map();

// Establish AMQP connection on server start
amqp.connect(configAMQP.url, function (err, conn) {
  if (err) {
    console.error("AMQP Connection Error:", err);
    return;
  }
  amqpConnection = conn;
  conn.createChannel(function (err, ch) {
    if (err) {
      console.error("AMQP Channel Creation Error:", err);
      return;
    }
    amqpChannel = ch;
    amqpChannel.assertExchange(AMQP_EXCHANGE, "topic", { durable: false });
    console.log("AMQP connection established and channel created.");
  });
});

app.use(express.static(__dirname + "/public"));

app.get("/", function (req, res) {});

http.listen(8083, function () {
  console.log("listening on *:8083");
});

io.on("connection", function (client) {
  /* User Handlers */
  client.on("register", function (userData) {
    userService
      .register(userData)
      .then(function (res) {
        client.emit("register_status", res.status);
      })
      .catch(function (err) {
        client.emit("register_status", err.status || 500);
      });
  });

  client.on("login", function (credential) {
    userService
      .login(credential, client.id)
      .then(function (res) {
        client.emit("login_resp", res.data);
        bindClientToUserQueue(client, res.data.userId);
      })
      .catch(function (err) {
        client.emit("login_resp", err.status || 500);
      });
  });

  client.on("getUserData", function (username) {
    userService
      .getUserData(username)
      .then(function (res) {
        client.emit("getUserData_resp", res.data);
      })
      .catch(function (err) {
        client.emit("getUserData_resp", err.status || 500);
      });
  });

  client.on("findUser", function (options) {
    userService
      .findUser(options)
      .then(function (res) {
        client.emit("findUser_resp", res);
      })
      .catch(function (err) {
        client.emit("findUser_resp", err.status || 500);
      });
  });

  client.on("find_friend", function (param) {
    userService
      .findFriends(param.userID)
      .then(function (list) {
        client.emit("find_friend_resp", list);
      })
      .catch(function (err) {});
  });

  client.on("add_friend", function (param) {
    userService
      .addFriend(param)
      .then(function (res) {
        client.emit("add_friend_resp", res.status);
        notifyViaMQ(
          `user.${res.targetId}`,
          {
            text: res.requesterName + " telah menambahkan teman dengan anda",
            roomID: SYSTEM_ROOM_ID,
            senderID: res.targetId,
          },
          { type: "friend_request", timestamp: res.data.createdAt },
        );
      })
      .catch(function (err) {
        client.emit("add_friend_resp", err.status || 500);
      });
  });

  /* Room Handlers */
  client.on("findRoom", function (userId) {
    roomService
      .findRooms(userId)
      .then(function (list) {
        client.emit("findRoom_resp", list);
      })
      .catch(function (err) {});
  });

  client.on("create", function (roomData) {
    roomService
      .createRoom(roomData)
      .then(function (res) {
        client.emit("create_resp", res);
        if (roomData && roomData.adminId) {
          bindUserToGroup(roomData.adminId, res);
        }
      })
      .catch(function (err) {
        client.emit("create_resp", 500);
      });
  });

  client.on("chat", function (roomData) {
    roomService
      .getOrCreatePrivateRoom(roomData)
      .then(function (res) {
        client.emit("chat_resp", res);
        if (res && res.created && Array.isArray(res.members)) {
          res.members.forEach(function (memberId) {
            bindUserToGroup(memberId, res.id);
          });
        }
      })
      .catch(function (err) {
        client.emit("chat_resp", 500);
      });
  });

  client.on("find_member", function (param) {
    roomService
      .findMembers(param.roomID)
      .then(function (list) {
        client.emit("find_member_resp", list);
      })
      .catch(function (err) {});
  });

  client.on("add", function (roomUserData) {
    roomService
      .addMember(roomUserData)
      .then(function (res) {
        client.emit("add_resp", res.status);
        if (res && res.status === 200 && res.addedUserId && res.roomId) {
          bindUserToGroup(res.addedUserId, res.roomId);
        }
        notifyViaMQ(
          `group.${roomUserData.roomId}`,
          {
            text: "seseorang telah ditambahkan dalam grup",
            roomID: roomUserData.roomId,
          },
          { type: "room_member_added", timestamp: res.res.createdAt },
        );
      })
      .catch(function (err) {
        client.emit("add_resp", err.status || 500);
      });
  });

  client.on("kick", function (roomUserData) {
    roomService
      .kickMember(roomUserData)
      .then(function (res) {
        client.emit("kick_resp", res.status);
        if (res && res.status === 200 && res.removedUserId && res.roomId) {
          unbindUserFromGroup(res.removedUserId, res.roomId);
        }
        notifyViaMQ(
          `group.${roomUserData.roomId}`,
          {
            text: "seseorang telah dikeluarkan dalam grup",
            roomID: roomUserData.roomId,
          },
          { type: "room_member_removed" },
        );
      })
      .catch(function (err) {
        client.emit("kick_resp", err.status || 500);
      });
  });

  /* Chat Handlers */
  client.on("send", function (messageData) {
    var cmdInfo = chatService.parseCommand(messageData.content);
    if (cmdInfo.isCommand) {
      if (cmdInfo.cmd === "add") {
        roomService
          .addMember({
            roomId: messageData.roomID,
            username: cmdInfo.targetUsername,
            callerId: messageData.senderID.toString(),
          })
          .then(function (res) {
            client.emit("add_resp", res.status);
            if (res && res.status === 200 && res.addedUserId && res.roomId) {
              bindUserToGroup(res.addedUserId, res.roomId);
            }
            notifyViaMQ(
              `group.${messageData.roomID}`,
              {
                text: "seseorang telah ditambahkan dalam grup",
                roomID: messageData.roomID,
              },
              { type: "room_member_added", timestamp: res.res.createdAt },
            );
          })
          .catch(function (err) {
            client.emit("add_resp", err.status || 500);
          });
      } else if (cmdInfo.cmd === "kick") {
        roomService
          .kickMember({
            roomId: messageData.roomID,
            username: cmdInfo.targetUsername,
            callerId: messageData.senderID.toString(),
          })
          .then(function (res) {
            client.emit("kick_resp", res.status);
            if (res && res.status === 200 && res.removedUserId && res.roomId) {
              unbindUserFromGroup(res.removedUserId, res.roomId);
            }
            notifyViaMQ(
              `group.${messageData.roomID}`,
              {
                text: "seseorang telah dikeluarkan dalam grup",
                roomID: messageData.roomID,
              },
              { type: "room_member_removed" },
            );
          })
          .catch(function (err) {
            client.emit("kick_resp", err.status || 500);
          });
      }
      return;
    }

    chatService
      .sendMessage(messageData)
      .then(function (res) {
        client.emit("send_resp", res.msg);
        if (res.isGroup) {
          notifyViaMQ(`group.${res.msg.roomID}`, res.msg, {
            type: "chat_message",
          });
        } else {
          _.each(res.notifyList, function (targetId) {
            notifyViaMQ(`user.${targetId}`, res.msg, { type: "chat_message" });
          });
        }
      })
      .catch(function (err) {
        client.emit("send_resp", 500);
      });
  });

  client.on("getMessage", function (messageOpt) {
    chatService
      .getMessages(messageOpt)
      .then(function (list) {
        client.emit("getMessage_resp", list);
      })
      .catch(function (err) {
        client.emit("getMessage_resp", 500);
      });
  });

  client.on("disconnect", function () {
    unbindClientFromQueue(client);
  });

  function bindClientToUserQueue(client, userId) {
    if (!amqpChannel) {
      console.error(
        "AMQP channel is not available. Cannot bind consumer for",
        userId,
      );
      return;
    }
    unbindClientFromQueue(client);

    var queueName = `queue.user.${userId}`;
    amqpChannel.assertQueue(queueName, { durable: false });
    ensureQueueBindings(queueName);
    amqpChannel.bindQueue(queueName, AMQP_EXCHANGE, `user.${userId}`);
    bindStoredUserGroups(userId);

    amqpChannel.consume(
      queueName,
      (msg) => {
        if (!msg) {
          return;
        }
        let envelope;
        try {
          envelope = JSON.parse(msg.content.toString());
        } catch (err) {
          console.error("Invalid AMQP payload:", err);
          amqpChannel.ack(msg);
          return;
        }
        amqpChannel.ack(msg);
        client.emit("receive", envelope);
      },
      { noAck: false },
      function (err, ok) {
        if (err) {
          console.error("Failed to start AMQP consumer for", queueName, err);
          return;
        }
        client._mqConsumerTag = ok.consumerTag;
        client._mqQueueName = queueName;
      },
    );
  }

  function unbindClientFromQueue(client) {
    if (!amqpChannel || !client._mqConsumerTag) {
      return;
    }
    amqpChannel.cancel(client._mqConsumerTag, function (err) {
      if (err) {
        console.error("Failed to cancel AMQP consumer:", err);
      }
    });
    client._mqConsumerTag = null;
    client._mqQueueName = null;
  }

  function bindUserToGroup(userId, roomId) {
    if (!amqpChannel) {
      return;
    }
    if (!userId || !roomId) {
      return;
    }
    const normalizedRoomId = roomId.toString ? roomId.toString() : roomId;
    if (!normalizedRoomId) {
      return;
    }
    const queueName = `queue.user.${userId}`;
    const bindings = ensureQueueBindings(queueName);
    if (bindings.has(normalizedRoomId)) {
      return;
    }
    amqpChannel.assertQueue(queueName, { durable: false });
    amqpChannel.bindQueue(
      queueName,
      AMQP_EXCHANGE,
      `group.${normalizedRoomId}`,
      {},
      function (err) {
        if (err) {
          console.error(
            "Failed to bind group route",
            queueName,
            normalizedRoomId,
            err,
          );
          return;
        }
        bindings.add(normalizedRoomId);
      },
    );
  }

  function unbindUserFromGroup(userId, roomId) {
    if (!amqpChannel) {
      return;
    }
    if (!userId || !roomId) {
      return;
    }
    const normalizedRoomId = roomId.toString ? roomId.toString() : roomId;
    if (!normalizedRoomId) {
      return;
    }
    const queueName = `queue.user.${userId}`;
    amqpChannel.unbindQueue(
      queueName,
      AMQP_EXCHANGE,
      `group.${normalizedRoomId}`,
      {},
      function (err) {
        if (err) {
          console.error("Failed to unbind group route", userId, roomId, err);
        }
      },
    );
    const bindings = queueGroupBindings.get(queueName);
    if (bindings) {
      bindings.delete(normalizedRoomId);
    }
  }

  function ensureQueueBindings(queueName) {
    if (!queueGroupBindings.has(queueName)) {
      queueGroupBindings.set(queueName, new Set());
    }
    return queueGroupBindings.get(queueName);
  }

  function bindStoredUserGroups(userId) {
    if (!userId) {
      return;
    }
    roomuserQ
      .find({ userId: userId })
      .then(function (memberships) {
        if (!memberships || memberships.length === 0) {
          return [];
        }
        const roomIds = Array.from(
          new Set(
            memberships
              .map(function (item) {
                if (!item || !item.roomId) return null;
                return item.roomId.toString
                  ? item.roomId.toString()
                  : item.roomId;
              })
              .filter(Boolean),
          ),
        );
        if (roomIds.length === 0) {
          return [];
        }
        return roomQ.find({
          _id: { $in: roomIds },
          adminId: { $exists: true, $ne: null },
        });
      })
      .then(function (rooms) {
        if (!rooms || rooms.length === 0) {
          return;
        }
        rooms.forEach(function (room) {
          bindUserToGroup(userId, room._id);
        });
      })
      .catch(function (err) {
        console.error("Failed to bind stored groups for user", userId, err);
      });
  }

  function notifyViaMQ(routingKey, payload, options = {}) {
    if (!amqpChannel) {
      console.error("AMQP channel is not available. Cannot send message.");
      return;
    }

    const normalizedPayload =
      typeof payload === "string" ? { text: payload } : payload || {};
    const envelope = {
      type: options.type || "notification",
      data: normalizedPayload,
      timestamp:
        options.timestamp ||
        normalizedPayload.datetime ||
        normalizedPayload.createdAt ||
        normalizedPayload.sentAt ||
        Date.now(),
    };

    amqpChannel.publish(
      AMQP_EXCHANGE,
      routingKey,
      Buffer.from(JSON.stringify(envelope)),
    );
    console.log(
      " [x] Published to " + routingKey + ": " + JSON.stringify(envelope),
    );
  }

  // Ensure the connection is closed when the server stops
  process.on("SIGINT", () => {
    if (amqpConnection) {
      amqpConnection.close();
      console.log("AMQP connection closed.");
    }
    process.exit(0);
  });
});
