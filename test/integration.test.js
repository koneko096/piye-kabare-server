const { expect } = require('chai');
const io = require('socket.io-client');
const amqp = require('amqplib');
const { spawn } = require('child_process');
const path = require('path');
const mongoose = require('mongoose');

describe('Server Integration Tests (Real Services)', function () {
    this.timeout(30000);
    let serverProcess;
    let socket;
    let amqpConn;
    let amqpChannel;

    before(async function () {
        // 1. Connect to MongoDB and RabbitMQ to verify they are up
        try {
            await mongoose.connect('mongodb://localhost:27017/pat');
            amqpConn = await amqp.connect('amqp://localhost');
            amqpChannel = await amqpConn.createChannel();

            // Cleanup previous test data
            await mongoose.connection.db.dropDatabase();
        } catch (err) {
            console.error('Core services (MongoDB/RabbitMQ) not available:', err.message);
            this.skip();
        }

        // 2. Start the server
        serverProcess = spawn('node', ['index.js'], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, NODE_ENV: 'test' }
        });

        // Wait for server to be ready
        await new Promise((resolve) => {
            serverProcess.stdout.on('data', (data) => {
                const str = data.toString();
                // console.log('Server STDOUT:', str);
                if (str.includes('listening on')) resolve();
            });
            serverProcess.stderr.on('data', (data) => {
                // console.error('Server STDERR:', data.toString());
            });
            setTimeout(resolve, 5000);
        });

        // 3. Connect Socket.io client
        socket = io('http://localhost:8083', { forceNew: true });
        await new Promise((resolve) => socket.on('connect', resolve));
    });

    after(async function () {
        if (socket) socket.disconnect();
        if (serverProcess) serverProcess.kill();
        if (amqpChannel) await amqpChannel.close();
        if (amqpConn) await amqpConn.close();
        await mongoose.disconnect();
    });

    it('should flow message from Socket.io to RabbitMQ on "send" event', async function () {
        // 1. Setup Data in DB via models (or socket events)
        // We'll use socket to register and create room to be more "E2E"

        // Register User 1
        socket.emit('register', { username: 'user1', name: 'User One', password: 'password' });
        await new Promise(r => socket.once('register_status', r));

        // Register User 2
        socket.emit('register', { username: 'user2', name: 'User Two', password: 'password' });
        await new Promise(r => socket.once('register_status', r));

        // Login User 1 to get ID
        socket.emit('login', { username: 'user1', password: 'password' });
        const loginData = await new Promise(r => socket.once('login_resp', r));
        const user1Id = loginData.userId;

        // Login User 2 to get ID
        socket.emit('login', { username: 'user2', password: 'password' });
        const loginData2 = await new Promise(r => socket.once('login_resp', r));
        const user2Id = loginData2.userId;

        // Create a room between them
        socket.emit('chat', { nameGroup: 'TestRoom', userId1: user1Id, userId2: user2Id });
        const roomId = await new Promise(r => socket.once('chat_resp', r));

        // 2. Listen to User 2's RabbitMQ Queue
        const qName = user2Id.toString();
        await amqpChannel.assertQueue(qName, { durable: false });

        const amqpPromise = new Promise((resolve) => {
            amqpChannel.consume(qName, (msg) => {
                if (msg !== null) {
                    const content = JSON.parse(msg.content.toString());
                    amqpChannel.ack(msg);
                    resolve(content);
                }
            });
        });

        // 3. User 1 sends a message
        const messageData = {
            roomID: roomId,
            senderID: user1Id,
            content: 'Hello from Integration Test'
        };
        socket.emit('send', messageData);

        // 4. Verify message received in RabbitMQ
        const mqMsg = await amqpPromise;
        expect(mqMsg).to.have.property('content', 'Hello from Integration Test');
        expect(mqMsg.senderID.toString()).to.equal(user1Id.toString());
    });
});
