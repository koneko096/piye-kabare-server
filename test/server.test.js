const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const EventEmitter = require('events');

describe('Socket.io Server Listeners (Stubbed)', function () {
    let userQStub, sessionQStub, socketStub;
    let registerHandler, loginHandler;

    beforeEach(function () {
        userQStub = {
            find: sinon.stub(),
            register: sinon.stub(),
            login: sinon.stub()
        };
        sessionQStub = {
            create: sinon.stub()
        };

        socketStub = new EventEmitter();
        socketStub.id = 'test-socket-id';
        socketStub.emit = sinon.stub();

        const amqpStub = {
            connect: sinon.stub()
        };

        // Load index.js with stubs
        proxyquire('../index.js', {
            './queries/user': userQStub,
            './queries/session': sessionQStub,
            './models/user': function (data) { return data; }, // Mock User constructor
            './models/session': function (data) { return data; }, // Mock Session constructor
            'amqplib/callback_api': amqpStub,
            'socket.io': function () {
                return {
                    on: function (event, callback) {
                        if (event === 'connection') {
                            callback(socketStub);
                        }
                    }
                };
            },
            'http': {
                Server: function () { return { listen: sinon.stub() }; },
                createServer: function () { return { listen: sinon.stub() }; }
            }
        });

        registerHandler = socketStub.listeners('register')[0];
        loginHandler = socketStub.listeners('login')[0];
    });

    afterEach(function () {
        sinon.restore();
    });

    const waitForEmit = (socket, event) => {
        return new Promise((resolve) => {
            const originalEmit = socket.emit;
            socket.emit = function (ev, ...args) {
                originalEmit.apply(socket, [ev, ...args]);
                if (ev === event) {
                    socket.emit = originalEmit;
                    resolve(args);
                }
            };
        });
    };

    it('should emit 300 if user already registered', async function () {
        userQStub.find.resolves([{ id: 'existing-id' }]);

        registerHandler({ username: 'testuser' });
        const args = await waitForEmit(socketStub, 'register_status');

        expect(args[0]).to.equal(300);
    });

    it('should emit 200 on successful registration', async function () {
        userQStub.find.resolves([]);
        userQStub.register.resolves('new-id');

        registerHandler({ username: 'newuser', name: 'New User' });
        const args = await waitForEmit(socketStub, 'register_status');

        expect(userQStub.register.calledOnce).to.be.true;
        expect(args[0]).to.equal(200);
    });

    it('should emit 401 on failed login', async function () {
        userQStub.login.resolves([]);

        loginHandler({ username: 'user', password: 'wrong' });
        const args = await waitForEmit(socketStub, 'login_resp');

        expect(args[0]).to.equal(401);
    });

    it('should emit user data and session on successful login', async function () {
        const mockUser = { id: 'user-id', username: 'user', name: 'Test' };
        userQStub.login.resolves([mockUser]);
        sessionQStub.create.resolves('mock-token');

        loginHandler({ username: 'user', password: 'correct' });
        const args = await waitForEmit(socketStub, 'login_resp');

        expect(sessionQStub.create.calledOnce).to.be.true;
        expect(args[0]).to.deep.include({
            userId: 'user-id',
            sessionId: 'mock-token'
        });
    });
});
