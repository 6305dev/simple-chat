require("dotenv").config();
const express = require("express");
const http = require("http");
const socketIo = require("socket.io");
const cors = require("cors");
const path = require("path");
const multer = require("multer");
const fs = require("fs");

// Import database dan models
const db = require("./models");
const { User, Message } = db;

const app = express();
const server = http.createServer(app);
const io = socketIo(server, {
  cors: {
    origin: "*", // Ganti dengan domain frontend Anda di produksi
    methods: ["GET", "POST"],
  },
});

// Middleware
app.use(cors());
app.use(express.json());

// --- UPLOAD GAMBAR ---
const uploadDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir);

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadDir),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowed = ["image/jpeg", "image/png", "image/gif", "image/webp"];
  if (allowed.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(
      new Error("Hanya file gambar (jpg, png, gif, webp) yang diperbolehkan."),
      false,
    );
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: { fileSize: 5 * 1024 * 1024 }, // maks 5 MB
});

// Serve folder uploads sebagai static
app.use("/uploads", express.static(uploadDir));

// Endpoint upload gambar
app.post("/api/upload", upload.single("image"), (req, res) => {
  if (!req.file) {
    return res.status(400).json({
      message: "Tidak ada file yang diunggah atau format tidak didukung.",
    });
  }
  const imageUrl = `/uploads/${req.file.filename}`;
  res.json({ imageUrl });
});

app.get("/admin", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "admin.html"));
});

app.get("/client", (req, res) => {
  res.sendFile(path.join(__dirname, "public", "client.html"));
});

// --- ROUTE API ---

// **API 1: Ambil semua pesan dari semua user untuk admin tertentu**
app.get("/api/messages/admin/:adminId", async (req, res) => {
  const { adminId } = req.params;
  try {
    const admin = await User.findByPk(adminId);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Invalid Admin ID" });
    }
    const messages = await Message.findAll({
      where: { isForAdmin: true },
      include: [{ model: User, as: "sender", attributes: ["id", "username"] }],
      order: [["createdAt", "DESC"]],
    });
    const groupedMessages = messages.reduce((acc, message) => {
      const senderId = message.sender.id;
      if (!acc[senderId]) {
        acc[senderId] = { user: message.sender, messages: [] };
      }
      acc[senderId].messages.push(message);
      return acc;
    }, {});
    res.json(Object.values(groupedMessages));
  } catch (error) {
    res.status(500).json({ message: "Error fetching messages", error });
  }
});

// **API 2: Ambil percakapan untuk user tertentu dengan admin tertentu**
app.get("/api/messages/:adminId/:userId", async (req, res) => {
  const { adminId, userId } = req.params;
  try {
    const admin = await User.findByPk(adminId);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Invalid Admin ID" });
    }
    const messages = await Message.findAll({
      where: {
        [db.Sequelize.Op.or]: [
          { senderId: userId, isForAdmin: true },
          { senderId: adminId, receiverId: userId },
        ],
      },
      include: [
        { model: User, as: "sender", attributes: ["id", "username"] },
        { model: User, as: "receiver", attributes: ["id", "username"] },
      ],
      order: [["createdAt", "ASC"]],
    });
    res.json(messages);
  } catch (error) {
    res.status(500).json({ message: "Error fetching conversation", error });
  }
});

// --- BARU: API untuk Notifikasi Badge ---

// **API 3: Ambil jumlah pesan belum dibaca untuk admin**
app.get("/api/messages/unread/admin/:adminId", async (req, res) => {
  const { adminId } = req.params;
  try {
    const admin = await User.findByPk(adminId);
    if (!admin || admin.role !== "admin") {
      return res.status(403).json({ message: "Invalid Admin ID" });
    }
    // Hitung pesan dari user yang belum dibaca
    const unreadCounts = await Message.findAll({
      attributes: [
        "senderId",
        [db.Sequelize.fn("COUNT", db.Sequelize.col("id")), "count"],
      ],
      where: {
        isForAdmin: true,
        isRead: false,
      },
      group: ["senderId"],
      raw: true,
    });
    res.json(unreadCounts); // Contoh hasil: [{senderId: 'user123', count: 2}, {senderId: 'user456', count: 1}]
  } catch (error) {
    res.status(500).json({ message: "Error fetching unread counts", error });
  }
});

// **API 4: Ambil jumlah pesan belum dibaca untuk user**
app.get("/api/messages/unread/user/:userId", async (req, res) => {
  const { userId } = req.params;
  try {
    const unreadCount = await Message.count({
      where: {
        receiverId: userId,
        isRead: false,
      },
    });
    res.json({ count: unreadCount });
  } catch (error) {
    res
      .status(500)
      .json({ message: "Error fetching unread count for user", error });
  }
});

// --- SOCKET.IO LOGIC ---
const connectedUsers = {}; // { socketId: { id, username, role } }

io.on("connection", (socket) => {
  console.log("New client connected:", socket.id);

  socket.on("register", async (userData) => {
    const { id, username, role } = userData;
    if (!id || !role) {
      socket.disconnect();
      return;
    }

    try {
      const [user, created] = await User.findOrCreate({
        where: { id: id },
        defaults: { username: username, role: role },
      });

      if (user.role !== role) {
        socket.disconnect();
        return;
      }

      connectedUsers[socket.id] = { id, role };
      socket.userId = id;
      socket.role = role;

      if (role === "admin") {
        socket.join("admin_room");
      }
    } catch (error) {
      console.error("Error during registration:", error);
      socket.disconnect();
    }
  });

  socket.on("sendMessageToAdmin", async (messageContent) => {
    if (!socket.userId) return;
    // Pesan baru otomatis isRead: false
    const newMessage = await Message.create({
      senderId: socket.userId,
      content: messageContent,
      isForAdmin: true,
    });
    const messageWithSender = await Message.findByPk(newMessage.id, {
      include: [{ model: User, as: "sender", attributes: ["id", "username"] }],
    });
    io.to("admin_room").emit("newMessageFromUser", messageWithSender);
  });

  // Kirim gambar dari user ke admin
  socket.on("sendImageToAdmin", async (imageUrl) => {
    if (!socket.userId) return;
    const newMessage = await Message.create({
      senderId: socket.userId,
      content: null,
      imageUrl: imageUrl,
      isForAdmin: true,
    });
    const messageWithSender = await Message.findByPk(newMessage.id, {
      include: [{ model: User, as: "sender", attributes: ["id", "username"] }],
    });
    io.to("admin_room").emit("newMessageFromUser", messageWithSender);
  });

  socket.on("replyToUser", async ({ userId, messageContent }) => {
    if (socket.role !== "admin") return;
    // Pesan baru otomatis isRead: false
    const newMessage = await Message.create({
      senderId: socket.userId,
      receiverId: userId,
      content: messageContent,
    });
    const messageWithDetails = await Message.findByPk(newMessage.id, {
      include: [
        { model: User, as: "sender", attributes: ["id", "username"] },
        { model: User, as: "receiver", attributes: ["id", "username"] },
      ],
    });
    const userSocketId = Object.keys(connectedUsers).find(
      (key) => connectedUsers[key].id === userId,
    );
    if (userSocketId) {
      io.to(userSocketId).emit("newMessageFromAdmin", messageWithDetails);
    }
    io.to("admin_room").emit("newMessageFromAdmin", messageWithDetails);
  });

  // Admin balas dengan gambar
  socket.on("replyImageToUser", async ({ userId, imageUrl }) => {
    if (socket.role !== "admin") return;
    const newMessage = await Message.create({
      senderId: socket.userId,
      receiverId: userId,
      content: null,
      imageUrl: imageUrl,
    });
    const messageWithDetails = await Message.findByPk(newMessage.id, {
      include: [
        { model: User, as: "sender", attributes: ["id", "username"] },
        { model: User, as: "receiver", attributes: ["id", "username"] },
      ],
    });
    const userSocketId = Object.keys(connectedUsers).find(
      (key) => connectedUsers[key].id === userId,
    );
    if (userSocketId) {
      io.to(userSocketId).emit("newMessageFromAdmin", messageWithDetails);
    }
    io.to("admin_room").emit("newMessageFromAdmin", messageWithDetails);
  });

  // --- BARU: Socket.IO untuk Mark as Read ---
  socket.on("markMessagesAsRead", async ({ otherUserId }) => {
    if (!socket.userId || !otherUserId) return;

    try {
      let whereClause = {};

      // Jika admin yang membaca, tandai pesan dari user tersebut
      if (socket.role === "admin") {
        whereClause = {
          senderId: otherUserId,
          isForAdmin: true,
          isRead: false,
        };
      }
      // Jika user yang membaca, tandai pesan dari admin
      else {
        whereClause = {
          senderId: otherUserId, // otherUserId adalah ID admin
          receiverId: socket.userId,
          isRead: false,
        };
      }

      const [affectedRows] = await Message.update(
        { isRead: true },
        { where: whereClause },
      );

      if (affectedRows > 0) {
        // Beritahu admin bahwa pesan telah dibaca, agar badge-nya bisa diperbarui
        if (socket.role === "user") {
          io.to("admin_room").emit("messagesRead", { userId: socket.userId });
        } else {
          // Jika admin yang baca, tidak perlu broadcast ke user, karena badge user tidak relevan di sini
          // Tapi bisa saja digunakan untuk sinkronasi antar tab admin
          io.to("admin_room").emit("messagesRead", { userId: otherUserId });
        }
      }
    } catch (error) {
      console.error("Error marking messages as read:", error);
    }
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected:", socket.id);
    delete connectedUsers[socket.id];
  });
});

// Sinkronisasi database dan jalankan server
db.sequelize.sync({ alter: true }).then(() => {
  const PORT = process.env.PORT || 3000;
  server.listen(PORT, () => console.log(`Server running on port ${PORT}`));
});
