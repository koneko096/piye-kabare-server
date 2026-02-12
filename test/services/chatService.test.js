var chai = require('chai');
var expect = chai.expect;
var sinon = require('sinon');
var proxyquire = require('proxyquire');

describe('ChatService', function () {
    var chatService;
    var messageQStub;
    var roomuserQStub;

    beforeEach(function () {
        messageQStub = {
            send: sinon.stub(),
            load: sinon.stub()
        };
        roomuserQStub = {
            find: sinon.stub()
        };

        chatService = proxyquire('../../services/chatService', {
            '../queries/message': messageQStub,
            '../queries/roomuser': roomuserQStub
        });
    });

    describe('sendMessage', function () {
        it('should send a message and returned notify list', function () {
            messageQStub.send.resolves({ roomID: 'room1', content: 'hello', senderID: 'user1' });
            roomuserQStub.find.resolves([
                { userId: 'user1' },
                { userId: 'user2' }
            ]);

            return chatService.sendMessage({ senderID: 'user1', roomID: 'room1', content: 'hello' }).then(function (res) {
                expect(res.msg.content).to.equal('hello');
                expect(res.notifyList).to.have.lengthOf(1);
                expect(res.notifyList[0]).to.equal('user2');
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
