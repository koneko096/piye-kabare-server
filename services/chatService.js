var Message = require('../models/message');
var messageQ = require('../queries/message');
var roomuserQ = require('../queries/roomuser');
var userQ = require('../queries/user');
var _ = require('lodash');

exports.sendMessage = function (messageData) {
    var MessageModel = _.pick(messageData, ['senderID', 'roomID', 'content']);
    return messageQ.send(new Message(MessageModel)).then(function (res) {
        return roomuserQ.find({ roomId: res.roomID }).then(function (res2) {
            var list = _.filter(res2, function (item) {
                return item.userId.toString() !== MessageModel.senderID.toString();
            }).map(function (item) { return item.userId; });
            return { msg: res, notifyList: list };
        });
    });
};

exports.getMessages = function (messageOpt) {
    var options = { roomID: messageOpt.roomID };
    return messageQ.load(options, messageOpt.page).then(function (res) {
        var promises = _.map(res, function (item) {
            return userQ.find({ _id: item.senderID }).then(function (res2) {
                return {
                    _id: item._id,
                    senderID: item.senderID,
                    roomID: item.roomID,
                    content: item.content,
                    createdAt: item.createdAt,
                    username: res2[0].username,
                    name: res2[0].name
                };
            });
        });
        return Promise.all(promises);
    });
};

exports.parseCommand = function (content) {
    if (content.startsWith('add ') || content.startsWith('kick ')) {
        var parts = content.split(' ');
        return {
            isCommand: true,
            cmd: parts[0],
            targetUsername: parts[1]
        };
    }
    return { isCommand: false };
};
