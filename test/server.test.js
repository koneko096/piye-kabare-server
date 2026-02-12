const { expect } = require('chai');
const sinon = require('sinon');
const proxyquire = require('proxyquire').noCallThru();
const EventEmitter = require('events');

describe('Socket.io Server Listeners (Stubbed)', function () {
    let userServiceStub, roomServiceStub, chatServiceStub, socketStub;
    let registerHandler, loginHandler;

    beforeEach(function () {
        userServiceStub = {
            register: sinon.stub(),
            login: sinon.stub(),
            getUserData: sinon.stub(),
            addFriend: sinon.stub(),
            findFriends: sinon.stub(),
            findUser: sinon.stub()
        };
        roomServiceStub = {
            findRooms: sinon.stub(),
            createRoom: sinon.stub(),
            getOrCreatePrivateRoom: sinon.stub(),
            findMembers: sinon.stub(),
            addMember: sinon.stub(),
            kickMember: sinon.stub()
        };
        chatServiceStub = {
            sendMessage: sinon.stub(),
            getMessages: sinon.stub(),
            parseCommand: sinon.stub()
        };

        socketStub = new EventEmitter();
        socketStub.id = 'test-socket-id';
        socketStub.emit = sinon.stub();

        const amqpStub = {
            connect: sinon.stub()
        };

        // Load index.js with stubs
        proxyquire('../index.js', {
            './services/userService': userServiceStub,
            './services/roomService': roomServiceStub,
            './services/chatService': chatServiceStub,
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
        userServiceStub.register.rejects({ status: 300 });

        registerHandler({ username: 'testuser' });
        const args = await waitForEmit(socketStub, 'register_status');

        expect(args[0]).to.equal(300);
    });

    it('should emit 200 on successful registration', async function () {
        userServiceStub.register.resolves({ status: 200 });

        registerHandler({ username: 'newuser', name: 'New User' });
        const args = await waitForEmit(socketStub, 'register_status');

        expect(userServiceStub.register.calledOnce).to.be.true;
        expect(args[0]).to.equal(200);
    });

    it('should emit 401 on failed login', async function () {
        userServiceStub.login.rejects({ status: 401 });

        loginHandler({ username: 'user', password: 'wrong' });
        const args = await waitForEmit(socketStub, 'login_resp');

        expect(args[0]).to.equal(401);
    });

    it('should emit user data and session on successful login', async function () {
        const mockResponse = { userId: 'user-id', username: 'user', name: 'Test', sessionId: 'mock-token' };
        userServiceStub.login.resolves({ status: 200, data: mockResponse });

        loginHandler({ username: 'user', password: 'correct' });
        const args = await waitForEmit(socketStub, 'login_resp');

        expect(userServiceStub.login.calledOnce).to.be.true;
        expect(args[0]).to.deep.include({
            userId: 'user-id',
            sessionId: 'mock-token'
        });
    });
});
