var User = require('../models/user');
var userQ = require('../queries/user');
var Friend = require('../models/friend');
var friendQ = require('../queries/friend');
var Session = require('../models/session');
var sessionQ = require('../queries/session');
var _ = require('lodash');

exports.register = function (userData) {
    var UserModel = {};
    _.forOwn(userData, function (value, key) {
        UserModel[key] = value;
    });

    var options = { username: UserModel.username };
    return userQ.find(options).then(function (res) {
        if (res.length > 0) {
            return Promise.reject({ status: 300, message: "Already registered" });
        }
        return userQ.register(new User(UserModel)).then(function (res) {
            return { status: 200, data: res };
        });
    });
};

exports.login = function (credential, socketId) {
    if (credential.password == "") credential.password = "lel";
    return userQ.login(credential).then(function (res) {
        if (res.length < 1) {
            return Promise.reject({ status: 401, message: "Error at login" });
        }
        var sesssionModel = {
            userId: res[0].id,
            socketId: socketId
        };
        return sessionQ.create(new Session(sesssionModel)).then(function (token) {
            var response = {
                userId: res[0].id,
                username: res[0].username,
                name: res[0].name,
                sessionId: token,
                socketId: socketId
            };
            return { status: 200, data: response };
        });
    });
};

exports.getUserData = function (username) {
    return userQ.find({ username: username }).then(function (res) {
        if (res.length < 1) {
            return Promise.reject({ status: 400, message: "User not found" });
        }
        var response = {
            userId: res[0].id,
            username: res[0].username
        };
        return { status: 200, data: response };
    });
};

exports.addFriend = function (param) {
    return userQ.find({ username: param.uname }).then(function (res) {
        if (res.length != 1) return Promise.reject({ status: 400 });
        var u1 = res[0].id;
        return userQ.find({ username: param.fname }).then(function (res2) {
            if (res2.length != 1) return Promise.reject({ status: 400 });
            var u2 = res2[0].id;
            var FriendModel = { userID: u1, userID2: u2 };
            return friendQ.find(FriendModel).then(function (res3) {
                if (res3.length > 0) return Promise.reject({ status: 300 });
                return friendQ.add(new Friend(FriendModel)).then(function (resp) {
                    return { status: 200, data: resp, targetId: u2, requesterName: param.uname };
                });
            });
        });
    });
};

exports.findFriends = function (userId) {
    var list = [];
    return friendQ.search({ userID: userId }).then(function (res) {
        var promises = _.map(res, function (item) {
            return userQ.find({ _id: item.userID2 }).then(function (res3) {
                res3[0].password = "";
                list.push(res3[0]);
            });
        });
        return Promise.all(promises).then(function () {
            return friendQ.search({ userID2: userId }).then(function (res2) {
                var promises2 = _.map(res2, function (item) {
                    return userQ.find({ _id: item.userID }).then(function (res3) {
                        res3[0].password = "";
                        list.push(res3[0]);
                    });
                });
                return Promise.all(promises2).then(function () {
                    return list;
                });
            });
        });
    });
};

exports.findUser = function (options) {
    return userQ.find(options).then(function (res) {
        if (res.length < 1) return Promise.reject({ status: 300 });
        return {
            userId: res[0].id,
            username: res[0].username,
            name: res[0].name
        };
    });
};
