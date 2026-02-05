var app = require('express')();
var express = require('express');
var _ = require('lodash');
var { v4: uuidv4 } = require('uuid');
var User = require('./models/user');
var userQ = require('./queries/user');
var Friend = require('./models/friend');
var friendQ = require('./queries/friend');
var Room = require('./models/room');
var roomQ = require('./queries/room');
var RoomUser = require('./models/roomuser');
var roomuserQ = require('./queries/roomuser');
var Message = require('./models/message');
var messageQ = require('./queries/message');
var Session = require('./models/session');
var sessionQ = require('./queries/session');

app.use(express.static(__dirname + '/public'));

var amqp = require('amqplib/callback_api');
app.get('/', function (req, res) {
  // res.send('Hello World');
  console.log(res);
});

var http = require('http').createServer(app);

http.listen(8083, function () {
  console.log('listening on *:8083');
});

var io = require('socket.io')(http, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

io.on('connection', function (client) {
  // TODO: push queue
  /* User */
  /* User */

  client.on('register', function (userData) {

    var UserModel = {};
    _.forOwn(userData, function (value, key) {
      UserModel[key] = value;
    });
    var options = {};
    options.username = UserModel["username"];
    userQ.find(options).then(function (res) {
      if (res.length > 0) {
        console.log("already registered");
        client.emit("register_status", 300);
        return;
      }
      userQ.register(new User(UserModel)).then(function (res) {
        client.emit("register_status", 200);
      });
    }).catch(function (err) {
      console.log(err);
      client.emit("register_status", 500);
    });
  });

  client.on('login', function (credential) {
    // body...
    if (credential.password == "") credential.password = "lel";
    console.log("onLogin");
    userQ.login(credential).then(function (res) {
      if (res.length < 1) {
        console.log("error at login");
        client.emit("login_resp", 401);
        return;
      }
      console.log("login");
      var sesssionModel = {};
      sesssionModel.userId = res[0].id;
      sesssionModel.socketId = client.id;
      sessionQ.create(new Session(sesssionModel)).then(function (token) {
        var response = {};
        response.userId = res[0].id;
        response.username = res[0].username;
        response.name = res[0].name;
        response.sessionId = token;
        response.socketId = client.id;
        client.emit("login_resp", response);
      });
    });
  });

  client.on('getUserData', function (username) {
    var options = {};
    options.username = username;
    userQ.find(options).then(function (res) {
      if (res.length < 1) {
        console.log("error at get user data");
        client.emit("getUserData_resp", 400);
        return;
      }

      var response = {};
      response.userId = res[0].id;
      response.username = res[0].username;
      client.emit("getUserData_resp", response);
    });
  });

  client.on('add_friend', function (param) {
    var options = {};
    options.username = param.uname;
    console.log("add_friend");
    userQ.find(options).then(function (res) {
      if (res.length != 1) {
        client.emit("add_friend_resp", 400);
        return;
      }
      var u1 = res[0].id;
      var options2 = {};
      options2.username = param.fname;
      userQ.find(options2).then(function (res2) {
        if (res2.length != 1) {
          client.emit("add_friend_resp", 400);
          return;
        }
        var u2 = res2[0].id;
        var FriendModel = {};
        FriendModel["userID"] = u1;
        FriendModel["userID2"] = u2;
        friendQ.find(FriendModel).then(function (res3) {
          if (res3.length > 0) {
            client.emit("add_friend_resp", 300);
            return;
          }
          friendQ.add(new Friend(FriendModel)).then(function (resp) {
            client.emit("add_friend_resp", 200);

            amqp.connect('amqp://localhost', function (err, conn) {
              conn.createChannel(function (err, ch) {
                var q = u2;
                var responseMQ = {};
                responseMQ.content = param.uname + " telah menambahkan teman dengan anda";
                responseMQ.datetime = resp.createdAt;
                ch.assertQueue(q, { durable: false });
                ch.sendToQueue(q, Buffer.from(JSON.stringify(responseMQ)));
                console.log(" [x] Sent " + JSON.stringify(responseMQ));
              });
            });

          });
        });
      });
    });
  });

  client.on('find_member', function (param) {
    var options = {};
    options.roomId = param.roomID;
    console.log("find_member");
    var list = [];
    roomuserQ.find(options).then(function (res) {
      // console.log(res);
      _.each(res, function (item) {
        var options = {};
        options._id = item.userId;
        userQ.find(options).then(function (res3) {
          res3[0].password = "";
          list.push(res3[0]);
          if (list.length >= res.length) {
            client.emit("find_member_resp", list);
            return;
          }
        });
      });
    });
  });

  client.on('find_friend', function (param) {
    var options = {};
    options.userID = param.userID;
    console.log("find_friend");
    var list = [];
    friendQ.search(options).then(function (res) {
      _.each(res, function (item) {
        var options = {};
        options._id = item.userID2;
        userQ.find(options).then(function (res3) {
          res3[0].password = "";
          list.push(res3[0]);
        });
      });
      var options2 = {};
      options2.userID2 = param.userID;
      friendQ.search(options2).then(function (res2) {
        _.each(res2, function (item) {
          var options = {};
          options._id = item.userID;
          userQ.find(options).then(function (res3) {
            res3[0].password = "";
            list.push(res3[0]);
            if (list.length >= res.length + res2.length) {
              client.emit("find_friend_resp", list);
              return;
            }
          });
        });
      });
    });
  });

  client.on('findUser', function (options) {
    userQ.find(options).then(function (res) {
      if (res.length < 1) {
        client.emit("findUser_resp", 300);
        return;
      }
      var response = {};
      response.userId = res[0].id;
      response.username = res[0].username;
      response.name = res[0].name;
      client.emit("findUser_resp", response);
      // userQ.register(new User(UserModel));
    });
  });

  /* Room */

  client.on('findRoom', function (userId) {
    var options = {};
    options.userId = userId;
    roomuserQ.find(options).then(function (res) {
      var arrRoom = [];
      if (res.length < 0) {
        client.emit("findRoom_resp", arrRoom);
        return;
      }
      _.each(res, function (item) {
        var options2 = {};
        var rooom = {};
        rooom._id = item.roomId;
        options2._id = item.roomId;
        roomQ.find(options2).then(function (resp) {
          if (resp[0].adminId) {
            rooom.adminId = resp[0].adminId;
            rooom.nameGroup = resp[0].nameGroup;
            arrRoom.push(rooom);
            if (arrRoom.length >= res.length) {
              client.emit("findRoom_resp", arrRoom);
              return;
            }
          }
          else {
            var options3 = {};
            options3.roomId = item.roomId;
            roomuserQ.find(options3).then(function (resp2) {
              if (resp2.length == 2) {
                _.each(resp2, function (items) {
                  if (items.userId != userId) {
                    var options3 = {};
                    options3._id = items.userId;
                    userQ.find(options3).then(function (resp3) {
                      rooom.nameGroup = resp3[0].name;
                      arrRoom.push(rooom);
                      if (arrRoom.length >= res.length) {
                        client.emit("findRoom_resp", arrRoom);
                        return;
                      }
                    });
                  }
                });
              }
            });
          }
        });
      });

    });
  });

  client.on('create', function (roomData) {
    var RoomModel = {};
    _.forOwn(roomData, function (value, key) {
      RoomModel[key] = value;
    });

    roomQ.create(new Room(RoomModel)).then(function (res) {
      var roomUserData = {
        "roomId": res,
        "userId": roomData["adminId"],
      };
      var RoomUserModel = {};
      _.forOwn(roomUserData, function (value, key) {
        RoomUserModel[key] = value;
      });
      roomuserQ.add(new RoomUser(RoomUserModel)).then(function (res) {
        client.emit("create_resp", res);
      });
    }).catch(function (err) {
      console.log(err);
      client.emit("create_resp", 500);
    });
    // body...
  });

  client.on('chat', function (roomData) {
    var RoomModel = {};
    _.forOwn(roomData, function (value, key) {
      RoomModel[key] = value;
    });
    var options = {};
    options.userId = roomData.userId1;
    roomuserQ.find(options)
      .then(function (res) {
        var len = 0;
        if (res.length == 0) {
          roomQ.create(new Room(RoomModel)).then(function (res) {
            var roomUserData = {
              "roomId": res,
              "userId": roomData["userId1"],
            };
            var RoomUserModel = {};
            _.forOwn(roomUserData, function (value, key) {
              RoomUserModel[key] = value;
            });
            roomuserQ.add(new RoomUser(RoomUserModel));
            RoomUserModel["userId"] = roomData["userId2"];
            roomuserQ.add(new RoomUser(RoomUserModel));
            client.emit("chat_resp", res);
            return;
          }).catch(function (err) {
            // console.log(err);
            client.emit("chat_resp", 500);
            return;
          });
        }
        for (var i = 0; i < res.length; i++) {
          var options2 = {};
          options2.userId = roomData.userId2;
          options2.roomId = res[i].roomId;
          roomuserQ.find(options2)
            .then(function (resz) {
              if (resz.length == 0 && i == res.length - 1) {
                roomQ.create(new Room(RoomModel)).then(function (res) {
                  var roomUserData = {
                    "roomId": res,
                    "userId": roomData["userId1"],
                  };
                  var RoomUserModel = {};
                  _.forOwn(roomUserData, function (value, key) {
                    RoomUserModel[key] = value;
                  });
                  roomuserQ.add(new RoomUser(RoomUserModel));
                  RoomUserModel["userId"] = roomData["userId2"];
                  roomuserQ.add(new RoomUser(RoomUserModel));
                  client.emit("chat_resp", res);
                  return;
                }).catch(function (err) {
                  console.log(err);
                  client.emit("chat_resp", 500);
                  return;
                });
              }
              else if (resz.length > 0) {
                // console.log(resz);
                client.emit("chat_resp", resz[0].roomId);
                return;
              }
            })
            .catch(function (err) {
              console.log(err);
              client.emit("chat_resp", 500);
            });
        }
      })
      .catch(function (err) {
        console.log(err);
        client.emit("chat_resp", 500);
      });
    // body...
  });

  client.on('add', function (roomUserData) {
    var RoomUserModel = {};
    _.forOwn(roomUserData, function (value, key) {
      RoomUserModel[key] = value;
    });
    roomuserQ.add(new RoomUser(RoomUserModel))
      .then(function (res) {
        client.emit("add_resp", 200);
        var options = {};
        options.roomId = RoomUserModel['roomId'];
        roomuserQ.find(options).then(function (res2) {
          var list = [];
          _.each(res2, function (item) {
            if (item.userId != RoomUserModel['userId']) {
              list.push(item.userId);
            }
          });
          amqp.connect('amqp://localhost', function (err, conn) {
            conn.createChannel(function (err, ch) {
              _.each(list, function (items) {
                var q = items.toString();
                var responseMQ = {};
                responseMQ.content = "seseorang telah ditambahkan dalam grup";
                responseMQ.datetime = Date.now;
                ch.assertQueue(q, { durable: false });
                ch.sendToQueue(q, Buffer.from(JSON.stringify(responseMQ)));
                console.log(" [x] Sent " + JSON.stringify(responseMQ));
              });
            });
          });
        });
      })
      .catch(function (err) {
        console.log(err);
        client.emit("add_resp", 500);
      });
    // body...
  });

  client.on('kick', function (roomUserData) {
    roomuserQ.remove(roomUserData)
      .then(function (res) {
        client.emit("kick_resp", 200);
        var options = {};
        options.roomId = roomUserData.roomId;
        roomuserQ.find(options).then(function (res2) {
          var list = [];
          _.each(res2, function (item) {
            list.push(item.userId);
          });
          amqp.connect('amqp://localhost', function (err, conn) {
            conn.createChannel(function (err, ch) {
              _.each(list, function (items) {
                var q = items.toString();
                var responseMQ = {};
                responseMQ.content = "seseorang telah dikeluarkan dalam grup";
                responseMQ.datetime = Date.now;
                ch.assertQueue(q, { durable: false });
                ch.sendToQueue(q, Buffer.from(JSON.stringify(responseMQ)));
                console.log(" [x] Sent " + JSON.stringify(responseMQ));
              });
            });
          });
        });
      })
      .catch(function (err) {
        console.log(err);
        client.emit("add_resp", 500);
      });
    // body...
  });

  /* Chat */
  client.on('send', function (messageData) {
    // body...
    var MessageModel = {};
    _.forOwn(messageData, function (value, key) {
      MessageModel[key] = value;
    });
    messageQ.send(new Message(MessageModel)).then(function (res) {
      client.emit("send_resp", res);
      var options = {};
      options.roomId = res.roomID;
      roomuserQ.find(options).then(function (res2) {
        var list = [];
        _.each(res2, function (item) {
          if (item.userId != MessageModel["senderID"]) {
            list.push(item.userId);
          }
        });
        amqp.connect('amqp://localhost', function (err, conn) {
          conn.createChannel(function (err, ch) {
            _.each(list, function (item) {
              var q = item.toString();
              ch.assertQueue(q, { durable: false });
              ch.sendToQueue(q, Buffer.from(JSON.stringify(res)));
              console.log(" [x] Sent " + JSON.stringify(res));
            });
          });
        });
      });
    }).catch(function (err) {
      console.log(err);
      client.emit("send_resp", 500);
    });
  });

  /* Chat */
  client.on('getMessage', function (messageOpt) {
    // body...
    var options = {};
    options.roomID = messageOpt.roomID;
    messageQ.load(options, messageOpt.page).then(function (res) {
      var i = 0;
      var list = [];
      _.each(res, function (item) {
        var options2 = {};
        options2._id = item.senderID;
        userQ.find(options2).then(function (res2) {
          // console.log(res2[0]);
          var items = {};
          items._id = item._id;
          items.senderID = item.senderID;
          items.roomID = item.roomID;
          items.content = item.content;
          items.createdAt = item.createdAt;
          items.username = res2[0].username;
          items.name = res2[0].name;
          list.push(items);
          if (list.length >= res.length) {
            client.emit("getMessage_resp", list);
          }
        });
      });
    }).catch(function (err) {
      console.log(err);
      client.emit("getMessage_resp", 500);
    });
  });

});
