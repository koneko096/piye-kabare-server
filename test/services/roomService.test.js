var chai = require('chai');
var expect = chai.expect;
var sinon = require('sinon');
var proxyquire = require('proxyquire');

describe('RoomService', function () {
    var roomService;
    var roomQStub;
    var roomuserQStub;
    var userQStub;

    beforeEach(function () {
        roomQStub = {
            find: sinon.stub(),
            create: sinon.stub()
        };
        roomuserQStub = {
            find: sinon.stub(),
            add: sinon.stub(),
            remove: sinon.stub()
        };
        userQStub = {
            find: sinon.stub()
        };

        roomService = proxyquire('../../services/roomService', {
            '../queries/room': roomQStub,
            '../queries/roomuser': roomuserQStub,
            '../queries/user': userQStub
        });
    });

    describe('addMember', function () {
        it('should add a member if caller is admin', function () {
            roomQStub.find.resolves([{ adminId: 'admin123' }]);
            userQStub.find.resolves([{ _id: 'user123' }]);
            roomuserQStub.find.onFirstCall().resolves([]); // Check if already in room
            roomuserQStub.add.resolves({ createdAt: new Date() });
            roomuserQStub.find.onSecondCall().resolves([]); // Notification list

            return roomService.addMember({ roomId: 'room1', username: 'testuser', callerId: 'admin123' }).then(function (res) {
                expect(res.status).to.equal(200);
                expect(roomuserQStub.add.calledOnce).to.be.true;
            });
        });

        it('should fail if caller is not admin', function () {
            roomQStub.find.resolves([{ adminId: 'otherAdmin' }]);

            return roomService.addMember({ roomId: 'room1', username: 'testuser', callerId: 'admin123' }).catch(function (err) {
                expect(err.status).to.equal(403);
            });
        });
    });

    describe('kickMember', function () {
        it('should kick a member if caller is admin', function () {
            roomQStub.find.resolves([{ adminId: 'admin123' }]);
            userQStub.find.resolves([{ _id: 'user123' }]);
            roomuserQStub.remove.resolves({});
            roomuserQStub.find.resolves([]);

            return roomService.kickMember({ roomId: 'room1', username: 'testuser', callerId: 'admin123' }).then(function (res) {
                expect(res.status).to.equal(200);
                expect(roomuserQStub.remove.calledOnce).to.be.true;
            });
        });
    });
});
