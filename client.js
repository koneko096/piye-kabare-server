console.log('1');

// Connect to server
var io = require('socket.io-client');
// var socket = io.connect('http://localhost:8083', {reconnect: true});
var socket = io('http://localhost:8083');
console.log('2');

// Add a connect listener
var credential = {};
// credential.id = '5818af2d7142924d54f6b284';
// credential.username = "ical";
// credential.password = "ganteng";
// credential.uname = "icalF";
// credential.fname = "rakinah48";
// var userData = {};
// userData["username"] = "ical" ;
// userData["name"] = "afrizal fikri" ;
// userData["password"] = "ganteng" ;
// socket.emit("register",userData);
// socket.emit("login",credential);
// socket.emit("add_friend",credential);
// socket.emit("findUser",credential);
// socket.emit("getUserData",'5818af2d7142924d54f6b284');
var messageData = {
"senderID" : '5818af2d7142924d54f6b284',
"roomID" : '581a8b0297740d176c6d7efc',
"content" : 'karepmu',
};
// socket.emit("findRoom",'5818af2d7142924d54f6b284');
//
// socket.emit("send",messageData);
var roomData = {};
// roomData.nameGroup = "keluargaical";
roomData.userId = '5819c13de293b0401e7528ec';
roomData.roomId = '581a8be1ef905225a4eeaf21';
// roomData.page = 0;
// roomData.content = 'hai guys';
// roomData.userId2 = '5819c49a08760b40bd884861';
socket.emit("kick",roomData);

socket.on('connect', function(socket) {
    console.log('Connected!');
});
socket.on('find_member_resp', function(data) {
    console.log('find_member_resp');
    console.log(data);
});
socket.on('kick_resp', function(data) {
    console.log(data);
});

socket.on('getMessage_resp', function(data) {
    console.log(data);
});

socket.on('send_resp', function(data) {
    console.log(data);
});

socket.on('findRoom_resp', function(data) {
    console.log(data);
});
socket.on('getUserData_resp', function(data) {
    console.log(data);
});
console.log('3');
var roomData2 = {};
// roomData.nameGroup = "keluargaical";
// roomData.senderID = '5819c13de293b0401e7528ec';
// roomData2.roomID = '581a8be1ef905225a4eeaf21';
// roomData2.page = 0;
// // roomData.page = 1;
// socket.emit("getMessage",roomData2);
