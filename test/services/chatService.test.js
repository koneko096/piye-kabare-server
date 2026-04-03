var chai = require('chai');
var expect = chai.expect;
var sinon = require('sinon');
var proxyquire = require('proxyquire');

describe('ChatService', function () {
    var chatService;
    var messageQStub;
    var roomuserQStub;
    var userQStub;
    var roomQStub;

    beforeEach(function () {
        messageQStub = {
            send: sinon.stub(),
            load: sinon.stub()
        };
        roomuserQStub = {
            find: sinon.stub()
        };
        userQStub = {
            find: sinon.stub()
        };
        roomQStub = {
            find: sinon.stub()
        };

        chatService = proxyquire('../../services/chatService', {
            '../queries/message': messageQStub,
            '../queries/roomuser': roomuserQStub,
            '../queries/user': userQStub,
            '../queries/room': roomQStub
        });
    });

    describe('sendMessage', function () {
        it('should send a message and returned notify list', function () {
            messageQStub.send.resolves({ roomID: 'room1', content: 'hello', senderID: 'user1' });
            userQStub.find.resolves([{ name: 'User One', username: 'user1' }]);
            roomQStub.find.resolves([]);
            roomuserQStub.find.resolves([
                { userId: 'user1' },
                { userId: 'user2' }
            ]);

            return chatService.sendMessage({ senderID: 'user1', roomID: 'room1', content: 'hello' }).then(function (res) {
                expect(res.msg.content).to.equal('hello');
                expect(res.msg.senderName).to.equal('User One');
                expect(res.notifyList).to.have.lengthOf(1);
                expect(res.notifyList[0]).to.equal('user2');
                expect(res.isGroup).to.equal(false);
            });
        });
    });

    describe('parseCommand', function () {
        it('should correctly parse add command', function () {
            var res = chatService.parseCommand('add targetUser');
            expect(res.isCommand).to.be.true;
            expect(res.cmd).to.equal('add');
            expect(res.targetUsername).to.equal('targetUser');
        });

        it('should correctly parse kick command', function () {
            var res = chatService.parseCommand('kick targetUser');
            expect(res.isCommand).to.be.true;
            expect(res.cmd).to.equal('kick');
        });

        it('should return isCommand: false for regular text', function () {
            var res = chatService.parseCommand('hello world');
            expect(res.isCommand).to.be.false;
        });
    });
});
