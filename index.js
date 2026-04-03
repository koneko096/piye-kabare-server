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
var configAMQP = require("./config/amqp.js");

// Global AMQP variables
let amqpChannel = null;
let amqpConnection = null;

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
          res.targetId,
          res.requesterName + " telah menambahkan teman dengan anda",
          res.data.createdAt,
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
        _.each(res.notifyList, function (targetId) {
          notifyViaMQ(
            targetId,
            "seseorang telah ditambahkan dalam grup",
            res.res.createdAt,
          );
        });
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
        _.each(res.notifyList, function (targetId) {
          notifyViaMQ(
            targetId,
            "seseorang telah dikeluarkan dalam grup",
            Date.now(),
          );
        });
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
            _.each(res.notifyList, function (targetId) {
              notifyViaMQ(
                targetId,
                "seseorang telah ditambahkan dalam grup",
                res.res.createdAt,
              );
            });
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
            _.each(res.notifyList, function (targetId) {
              notifyViaMQ(
                targetId,
                "seseorang telah dikeluarkan dalam grup",
                Date.now(),
              );
            });
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
        _.each(res.notifyList, function (targetId) {
          notifyViaMQ(targetId, JSON.stringify(res.msg), null, true);
        });
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

  function notifyViaMQ(targetId, content, datetime, isRaw) {
    if (!amqpChannel) {
      console.error("AMQP channel is not available. Cannot send message.");
      return;
    }

    var q = targetId.toString();
    var payload = isRaw
      ? content
      : JSON.stringify({
          content: content,
          datetime: datetime || Date.now(),
        });

    // Assert queue before sending to ensure it exists
    amqpChannel.assertQueue(q, { durable: false });
    amqpChannel.sendToQueue(q, Buffer.from(payload));
    console.log(" [x] Sent to " + q + ": " + payload);
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
