var Room = require('../models/room');
var roomQ = require('../queries/room');
var RoomUser = require('../models/roomuser');
var roomuserQ = require('../queries/roomuser');
var userQ = require('../queries/user');
var _ = require('lodash');

exports.findRooms = function (userId) {
    return roomuserQ.find({ userId: userId }).then(function (res) {
        var arrRoom = [];
        if (res.length === 0) return arrRoom;
        var promises = _.map(res, function (item) {
            return roomQ.find({ _id: item.roomId }).then(function (resp) {
                if (!resp || resp.length === 0) return;
                var rooom = { _id: item.roomId };
                if (resp[0].adminId) {
                    rooom.adminId = resp[0].adminId;
                    rooom.nameGroup = resp[0].nameGroup;
                    arrRoom.push(rooom);
                } else {
                    return roomuserQ.find({ roomId: item.roomId }).then(function (resp2) {
                        if (resp2.length == 2) {
                            var otherMember = _.find(resp2, function (m) { return m.userId.toString() !== userId.toString(); });
                            if (otherMember) {
                                return userQ.find({ _id: otherMember.userId }).then(function (resp3) {
                                    rooom.nameGroup = resp3[0].name;
                                    arrRoom.push(rooom);
                                });
                            }
                        }
                    });
                }
            });
        });
        return Promise.all(promises).then(function () {
            return arrRoom;
        });
    });
};

exports.createRoom = function (roomData) {
    return roomQ.create(new Room(roomData)).then(function (res) {
        var roomUserData = {
            roomId: res,
            userId: roomData.adminId
        };
        return roomuserQ.add(new RoomUser(roomUserData)).then(function () {
            return res;
        });
    });
};

exports.getOrCreatePrivateRoom = function (roomData) {
    var userId1 = roomData.userId1;
    var userId2 = roomData.userId2;
    return roomuserQ.find({ userId: userId1 }).then(function (res) {
        if (res.length === 0) {
            return createPrivateRoom(roomData);
        }

        var findRoomPromise = Promise.resolve(null);
        for (var i = 0; i < res.length; i++) {
            (function (index) {
                findRoomPromise = findRoomPromise.then(function (foundRoomId) {
                    if (foundRoomId) return foundRoomId;
                    return roomuserQ.find({ userId: userId2, roomId: res[index].roomId }).then(function (resz) {
                        if (resz.length > 0) return resz[0].roomId;
                        if (index === res.length - 1) return createPrivateRoom(roomData);
                        return null;
                    });
                });
            })(i);
        }
        return findRoomPromise;
    });
};

function createPrivateRoom(roomData) {
    var RoomModel = { nameGroup: roomData.nameGroup };
    return roomQ.create(new Room(RoomModel)).then(function (res) {
        var roomUserData1 = { roomId: res, userId: roomData.userId1 };
        var roomUserData2 = { roomId: res, userId: roomData.userId2 };
        return roomuserQ.add(new RoomUser(roomUserData1)).then(function () {
            return roomuserQ.add(new RoomUser(roomUserData2)).then(function () {
                return res;
            });
        });
    });
}

exports.findMembers = function (roomId) {
    var list = [];
    return roomuserQ.find({ roomId: roomId }).then(function (res) {
        var promises = _.map(res, function (item) {
            return userQ.find({ _id: item.userId }).then(function (res3) {
                res3[0].password = "";
                list.push(res3[0]);
            });
        });
        return Promise.all(promises).then(function () {
            return list;
        });
    });
};

exports.addMember = function (roomUserData) {
    return new Promise(function (resolve, reject) {
        var RoomUserModel = _.pick(roomUserData, ['roomId', 'userId', 'username', 'callerId']);

        // Check if sender is admin
        roomQ.find({ _id: RoomUserModel.roomId }).then(function (room) {
            if (room.length > 0 && room[0].adminId && room[0].adminId.toString() === RoomUserModel.callerId) {
                // If username provided instead of userId, find it
                var findUserPromise = Promise.resolve(RoomUserModel.userId);
                if (!RoomUserModel.userId && RoomUserModel.username) {
                    findUserPromise = userQ.find({ username: RoomUserModel.username }).then(function (users) {
                        return users.length > 0 ? users[0]._id : null;
                    });
                }

                findUserPromise.then(function (userId) {
                    if (!userId) {
                        return reject({ status: 400 });
                    }
                    RoomUserModel.userId = userId;

                    roomuserQ.find({ roomId: RoomUserModel.roomId, userId: userId }).then(function (existing) {
                        if (existing.length > 0) {
                            return reject({ status: 300 });
                        }

                        roomuserQ.add(new RoomUser({ roomId: RoomUserModel.roomId, userId: RoomUserModel.userId }))
                            .then(function (res) {
                                roomuserQ.find({ roomId: RoomUserModel.roomId }).then(function (res2) {
                                    var list = _.filter(res2, function (item) {
                                        return item.userId.toString() !== RoomUserModel.userId.toString();
                                    }).map(function (item) { return item.userId; });

                                    resolve({ status: 200, res: res, notifyList: list });
                                });
                            })
                            .catch(function (err) {
                                console.log(err);
                                reject({ status: 500 });
                            });
                    });
                });
            } else {
                reject({ status: 403 });
            }
        });
    });
};

exports.kickMember = function (roomUserData) {
    return new Promise(function (resolve, reject) {
        roomQ.find({ _id: roomUserData.roomId }).then(function (room) {
            if (room.length > 0 && room[0].adminId && room[0].adminId.toString() === roomUserData.callerId) {
                var findUserPromise = Promise.resolve(roomUserData.userId);
                if (!roomUserData.userId && roomUserData.username) {
                    findUserPromise = userQ.find({ username: roomUserData.username }).then(function (users) {
                        return users.length > 0 ? users[0]._id : null;
                    });
                }

                findUserPromise.then(function (userId) {
                    if (!userId) {
                        return reject({ status: 400 });
                    }
                    var options = { roomId: roomUserData.roomId, userId: userId };
                    roomuserQ.remove(options)
                        .then(function (res) {
                            roomuserQ.find({ roomId: options.roomId }).then(function (res2) {
                                var list = _.map(res2, function (item) {
                                    return item.userId;
                                });
                                resolve({ status: 200, notifyList: list });
                            });
                        })
                        .catch(function (err) {
                            console.log(err);
                            reject({ status: 500 });
                        });
                });
            } else {
                reject({ status: 403 });
            }
        });
    });
};
