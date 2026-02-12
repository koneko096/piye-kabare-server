var chai = require('chai');
var expect = chai.expect;
var sinon = require('sinon');
var proxyquire = require('proxyquire');

describe('UserService', function () {
    var userService;
    var userQStub;
    var sessionQStub;

    beforeEach(function () {
        userQStub = {
            find: sinon.stub(),
            register: sinon.stub(),
            login: sinon.stub()
        };
        sessionQStub = {
            create: sinon.stub()
        };

        userService = proxyquire('../../services/userService', {
            '../queries/user': userQStub,
            '../queries/session': sessionQStub
        });
    });

    describe('register', function () {
        it('should register a new user successfully', function () {
            userQStub.find.resolves([]);
            userQStub.register.resolves({ id: '123' });

            return userService.register({ username: 'testuser' }).then(function (res) {
                expect(res.status).to.equal(200);
                expect(userQStub.register.calledOnce).to.be.true;
            });
        });

        it('should fail if user already exists', function () {
            userQStub.find.resolves([{ id: '123' }]);

            return userService.register({ username: 'testuser' }).catch(function (err) {
                expect(err.status).to.equal(300);
                expect(userQStub.register.called).to.be.false;
            });
        });
    });

    describe('login', function () {
        it('should login successfully and return session data', function () {
            userQStub.login.resolves([{ id: '123', username: 'testuser', name: 'Test User' }]);
            sessionQStub.create.resolves('mock-token');

            return userService.login({ username: 'testuser', password: 'pw' }, 'socket123').then(function (res) {
                expect(res.status).to.equal(200);
                expect(res.data.sessionId).to.equal('mock-token');
                expect(res.data.userId).to.equal('123');
            });
        });

        it('should return 401 if login fails', function () {
            userQStub.login.resolves([]);

            return userService.login({ username: 'testuser', password: 'pw' }, 'socket123').catch(function (err) {
                expect(err.status).to.equal(401);
            });
        });
    });
});
