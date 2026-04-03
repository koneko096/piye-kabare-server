const { expect } = require("chai");
const io = require("socket.io-client");
const amqp = require("amqplib");
const { spawn } = require("child_process");
const path = require("path");
const mongoose = require("mongoose");
process.env.NODE_ENV = "test";
const dbHelper = require("../helpers/database");
dbHelper.connect(dbHelper.databases.test);

describe("Server Integration Tests (Real Services)", function () {
  this.timeout(10000);
  let serverProcess;
  let inProcessServer = false;
  let socket;
  let amqpConn;
  let amqpChannel;

  const log = (...args) => {
    console.log("[integration]", ...args);
  };

  const waitForSocketEvent = (socketInstance, event, timeoutMs = 15000) =>
    new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for socket event: ${event}`));
      }, timeoutMs);
      socketInstance.once(event, (payload) => {
        clearTimeout(timer);
        resolve(payload);
      });
    });

  before(async function () {
    // 1. Connect to MongoDB and RabbitMQ to verify they are up
    try {
      dbHelper.connect(dbHelper.databases.test);
      if (mongoose.connection.readyState !== 1) {
        await new Promise((resolve, reject) => {
          mongoose.connection.once("open", resolve);
          mongoose.connection.once("error", reject);
        });
      }
      amqpConn = await amqp.connect("amqp://localhost");
      amqpChannel = await amqpConn.createChannel();

      // Cleanup previous test data
      if (mongoose.connection.db) {
        await mongoose.connection.db.dropDatabase();
      }
    } catch (err) {
      console.error(
        "Core services (MongoDB/RabbitMQ) not available:",
        err.message,
      );
      this.skip();
    }

    // 2. Start the server
    try {
      serverProcess = spawn(process.execPath, ["index.js"], {
        cwd: path.join(__dirname, ".."),
        env: { ...process.env, NODE_ENV: "test" },
      });
    } catch (err) {
      log("spawn failed, falling back to in-process server:", err.message);
      inProcessServer = true;
      require("../index.js");
    }

    // Wait for server + AMQP to be ready
    if (!inProcessServer && serverProcess) {
      await new Promise((resolve) => {
        let serverReady = false;
        let amqpReady = false;
        serverProcess.stdout.on("data", (data) => {
          const str = data.toString();
          log("server stdout:", str.trim());
          if (str.includes("listening on")) {
            serverReady = true;
          }
          if (str.includes("AMQP connection established")) {
            amqpReady = true;
          }
          if (serverReady && amqpReady) {
            resolve();
          }
        });
        serverProcess.stderr.on("data", (data) => {
          log("server stderr:", data.toString().trim());
        });
        setTimeout(resolve, 5000);
      });
    } else {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }

    // 3. Connect Socket.io client
    socket = io("http://localhost:8083", { forceNew: true });
    socket.on("connect_error", (err) => {
      log("socket connect_error:", err && err.message ? err.message : err);
    });
    socket.onAny((event, ...args) => {
      if (event !== "receive") {
        log("socket event:", event, JSON.stringify(args));
      }
    });
    await new Promise((resolve) => socket.on("connect", resolve));
  });

  after(async function () {
    if (socket) socket.disconnect();
    if (serverProcess) serverProcess.kill();
    if (amqpChannel) await amqpChannel.close();
    if (amqpConn) await amqpConn.close();
    await mongoose.disconnect();
  });

  it("should deliver DM via user.<id> routing", async function () {
    // 1. Setup Data in DB via models (or socket events)
    // We'll use socket to register and create room to be more "E2E"

    // Register User 1
    socket.emit("register", {
      username: "user1",
      name: "User One",
      password: "password",
    });
    await waitForSocketEvent(socket, "register_status");

    // Register User 2
    socket.emit("register", {
      username: "user2",
      name: "User Two",
      password: "password",
    });
    await waitForSocketEvent(socket, "register_status");

    // Login User 1 to get ID
    socket.emit("login", { username: "user1", password: "password" });
    const loginData = await waitForSocketEvent(socket, "login_resp");
    const user1Id = loginData.userId;

    // Login User 2 to get ID
    socket.emit("login", { username: "user2", password: "password" });
    const loginData2 = await waitForSocketEvent(socket, "login_resp");
    const user2Id = loginData2.userId;

    // Create a room between them
    socket.emit("chat", {
      nameGroup: "TestRoom",
      userId1: user1Id,
      userId2: user2Id,
    });
    const roomResp = await waitForSocketEvent(socket, "chat_resp");
    const roomId = roomResp && roomResp.id ? roomResp.id : roomResp;
    expect(roomId).to.exist;

    // 2. Listen on a dedicated test queue bound to user.<id>
    await amqpChannel.assertExchange("chat_exchange", "topic", {
      durable: false,
    });
    const testQueue = `test.queue.user.${user2Id}.${Date.now()}`;
    await amqpChannel.assertQueue(testQueue, {
      durable: false,
      exclusive: true,
      autoDelete: true,
    });
    await amqpChannel.bindQueue(
      testQueue,
      "chat_exchange",
      `user.${user2Id}`,
      {},
    );

    const amqpPromise = new Promise((resolve) => {
      amqpChannel.consume(testQueue, (msg) => {
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
      content: "Hello from Integration Test",
    };
    socket.emit("send", messageData);

    // 4. Verify message received in RabbitMQ
    const mqMsg = await amqpPromise;
    expect(mqMsg).to.have.property("type", "chat_message");
    expect(mqMsg.data).to.have.property(
      "content",
      "Hello from Integration Test",
    );
    expect(mqMsg.data.senderID.toString()).to.equal(user1Id.toString());
  });

  it("should deliver group chat via group.<roomId> routing", async function () {
    // Register admin
    socket.emit("register", {
      username: "groupadmin",
      name: "Group Admin",
      password: "password",
    });
    await waitForSocketEvent(socket, "register_status");
    socket.emit("login", { username: "groupadmin", password: "password" });
    const loginAdmin = await waitForSocketEvent(socket, "login_resp");
    const adminId = loginAdmin.userId;

    // Register member
    socket.emit("register", {
      username: "groupmember",
      name: "Group Member",
      password: "password",
    });
    await waitForSocketEvent(socket, "register_status");
    socket.emit("login", { username: "groupmember", password: "password" });
    const loginMember = await waitForSocketEvent(socket, "login_resp");
    const memberId = loginMember.userId;

    // Create group room
    socket.emit("create", { nameGroup: "TestGroup", adminId: adminId });
    const roomId = await waitForSocketEvent(socket, "create_resp");
    expect(roomId).to.exist;

    // Add member to group
    socket.emit("add", {
      roomId: roomId,
      userId: memberId,
      callerId: adminId,
    });
    const addStatus = await waitForSocketEvent(socket, "add_resp");
    expect(addStatus).to.equal(200);

    // Listen on a dedicated test queue bound to group.<roomId>
    await amqpChannel.assertExchange("chat_exchange", "topic", {
      durable: false,
    });
    const testQueue = `test.queue.group.${roomId}.${Date.now()}`;
    await amqpChannel.assertQueue(testQueue, {
      durable: false,
      exclusive: true,
      autoDelete: true,
    });
    await amqpChannel.bindQueue(
      testQueue,
      "chat_exchange",
      `group.${roomId}`,
      {},
    );

    const amqpPromise = new Promise((resolve) => {
      amqpChannel.consume(testQueue, (msg) => {
        if (msg !== null) {
          const content = JSON.parse(msg.content.toString());
          amqpChannel.ack(msg);
          resolve(content);
        }
      });
    });

    // Send group message
    socket.emit("send", {
      roomID: roomId,
      senderID: adminId,
      content: "Hello Group",
    });

    const mqMsg = await amqpPromise;
    expect(mqMsg).to.have.property("type", "chat_message");
    expect(mqMsg.data).to.have.property("content", "Hello Group");
    expect(mqMsg.data.roomID.toString()).to.equal(roomId.toString());
  });

  it("should show mutual friendship when A adds B", async function () {
    // Register and Login User A (Alice)
    socket.emit("register", {
      username: "alice",
      name: "Alice",
      password: "password",
    });
    await waitForSocketEvent(socket, "register_status");
    socket.emit("login", { username: "alice", password: "password" });
    const loginAlice = await waitForSocketEvent(socket, "login_resp");
    const aliceId = loginAlice.userId;

    // Register and Login User B (Bob)
    socket.emit("register", {
      username: "bob",
      name: "Bob",
      password: "password",
    });
    await waitForSocketEvent(socket, "register_status");
    socket.emit("login", { username: "bob", password: "password" });
    const loginBob = await waitForSocketEvent(socket, "login_resp");
    const bobId = loginBob.userId;

    // Prepare to verify friend_request notification uses self room
    await amqpChannel.assertExchange("chat_exchange", "topic", {
      durable: false,
    });
    const notifyQueue = `test.queue.friend.${bobId}.${Date.now()}`;
    await amqpChannel.assertQueue(notifyQueue, {
      durable: false,
      exclusive: true,
      autoDelete: true,
    });
    await amqpChannel.bindQueue(
      notifyQueue,
      "chat_exchange",
      `user.${bobId}`,
      {},
    );

    const friendNotifyPromise = new Promise((resolve) => {
      amqpChannel.consume(notifyQueue, (msg) => {
        if (msg !== null) {
          const content = JSON.parse(msg.content.toString());
          amqpChannel.ack(msg);
          resolve(content);
        }
      });
    });

    // Alice adds Bob as friend
    socket.emit("add_friend", { uname: "alice", fname: "bob" });
    const addStatus = await waitForSocketEvent(socket, "add_friend_resp");
    expect(addStatus).to.equal(200);
    const friendNotify = await friendNotifyPromise;
    expect(friendNotify).to.have.property("type", "friend_request");
    expect(friendNotify.data).to.have.property("roomID", "1");
    expect(friendNotify.data.senderID.toString()).to.equal(bobId.toString());

    // Fetch Alice's friend list - should include Bob
    socket.emit("find_friend", { userID: aliceId });
    const aliceFriends = await waitForSocketEvent(socket, "find_friend_resp");
    expect(aliceFriends).to.be.an("array");
    expect(aliceFriends.some((f) => f.username === "bob")).to.be.true;

    // Fetch Bob's friend list - should include Alice
    socket.emit("find_friend", { userID: bobId });
    const bobFriends = await waitForSocketEvent(socket, "find_friend_resp");
    expect(bobFriends).to.be.an("array");
    expect(bobFriends.some((f) => f.username === "alice")).to.be.true;
  });
});
