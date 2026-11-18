const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();
    const db = client.db("noiroboDB");
    const equipmentCollection = db.collection("equipment");
    const usersCollection = db.collection("users");
    console.log("MongoDB connected successfully");

    // ================= MIDDLEWARES =================
    const verifyToken = (req, res, next) => {
      const authHeader = req.headers.authorization;
      if (!authHeader || !authHeader.startsWith("Bearer ")) {
        return res.status(401).send({ message: "unauthorized access" });
      }
      const token = authHeader.split(" ")[1];
      jwt.verify(token, process.env.JWT_SECRET, (err, decoded) => {
        if (err) return res.status(401).send({ message: "unauthorized access" });
        req.decoded = decoded;
        next();
      });
    };

    const verifyRole = (role) => async (req, res, next) => {
      const user = await usersCollection.findOne({ email: req.decoded.email });
      if (!user || user.role !== role) {
        return res.status(403).send({ message: "forbidden access" });
      }
      req.user = user;
      next();
    };

    const verifyRenter = verifyRole("customer");
    const verifyOwner = verifyRole("owner");
    const verifyAdmin = verifyRole("admin");

    // owner নিজের equipment বা admin যেকোনোটা বদলাতে পারবে
    const canModify = async (req, res, next) => {
      try {
        const user = await usersCollection.findOne({ email: req.decoded.email });
        const item = await equipmentCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!user || !item) return res.status(404).send({ message: "Not found" });
        if (user.role !== "admin" && item.ownerEmail !== user.email) {
          return res.status(403).send({ message: "forbidden access" });
        }
        next();
      } catch (error) {
        res.status(400).send({ message: "Invalid id" });
      }
    };

    // ================= AUTH & USERS =================
    // login-এর পর token নাও
    app.post("/jwt", async (req, res) => {
      const { email } = req.body;
      const user = await usersCollection.findOne({ email });
      if (!user) return res.status(404).send({ message: "User not found" });
      const token = jwt.sign({ email }, process.env.JWT_SECRET, {
        expiresIn: "7d",
      });
      res.send({ token, role: user.role });
    });

    // register / google login-এর পর user সংরক্ষণ (role সবসময় customer)
    app.post("/users", async (req, res) => {
      const { name, email, photo } = req.body;
      if (!email) return res.status(400).send({ message: "Email required" });
      const result = await usersCollection.updateOne(
        { email },
        {
          $setOnInsert: {
            name: name || "",
            email,
            photo: photo || "",
            role: "customer",
            phone: "",
            address: "",
            createdAt: new Date(),
          },
        },
        { upsert: true }
      );
      res.send(result);
    });

    // নিজের তথ্য দেখা
    app.get("/users/me", verifyToken, async (req, res) => {
      const user = await usersCollection.findOne({ email: req.decoded.email });
      res.send(user);
    });

    // নিজের profile বদলানো
    app.patch("/users/me", verifyToken, async (req, res) => {
      const { name, photo, phone, address } = req.body;
      const updateDoc = {};
      if (name !== undefined) updateDoc.name = name;
      if (photo !== undefined) updateDoc.photo = photo;
      if (phone !== undefined) updateDoc.phone = phone;
      if (address !== undefined) updateDoc.address = address;
      const result = await usersCollection.updateOne(
        { email: req.decoded.email },
        { $set: updateDoc }
      );
      res.send(result);
    });

    // Admin: সব user
    app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
      const result = await usersCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // Admin: role বদলানো
    app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
      const { role } = req.body;
      if (!["customer", "owner", "admin"].includes(role)) {
        return res.status(400).send({ message: "Invalid role" });
      }
      const result = await usersCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { role } }
      );
      res.send(result);
    });

    // ================= EQUIPMENT =================
    // Owner: নতুন equipment (status সবসময় pending)
    app.post("/equipment", verifyToken, verifyOwner, async (req, res) => {
      const equipment = {
        ...req.body,
        price: Number(req.body.price),
        quantity: Number(req.body.quantity),
        ownerEmail: req.user.email,
        ownerName: req.user.name,
        status: "pending",
        createdAt: new Date(),
      };
      const result = await equipmentCollection.insertOne(equipment);
      res.send(result);
    });

    // Home page: approved equipment (?segment=robot&limit=4)
    app.get("/equipment/featured", async (req, res) => {
      const { segment, limit = 6 } = req.query;
      const query = { status: "approved" };
      if (segment) query.segment = segment;
      const result = await equipmentCollection
        .find(query)
        .sort({ createdAt: -1 })
        .limit(Number(limit))
        .toArray();
      res.send(result);
    });

    // Owner: নিজের equipment
    app.get("/equipment/mine", verifyToken, verifyOwner, async (req, res) => {
      const result = await equipmentCollection
        .find({ ownerEmail: req.user.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // Admin: সব equipment (pending, approved, rejected)
    app.get("/admin/equipment", verifyToken, verifyAdmin, async (req, res) => {
      const result = await equipmentCollection
        .find()
        .sort({ createdAt: -1 })
        .toArray();
      res.send(result);
    });

    // Public: approved equipment (সার্চ, ফিল্টার, সর্ট, pagination)
    app.get("/equipment", async (req, res) => {
      const {
        search,
        category,
        segment,
        rentalType,
        minPrice,
        maxPrice,
        availability,
        sort,
        page = 1,
        limit = 9,
      } = req.query;

      const query = { status: "approved" };

      if (search) {
        const safe = search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        query.$or = [
          { name: { $regex: safe, $options: "i" } },
          { location: { $regex: safe, $options: "i" } },
          { category: { $regex: safe, $options: "i" } },
        ];
      }
      if (category) query.category = category;
      if (segment) query.segment = segment;
      if (rentalType) query.rentalType = rentalType;
      if (minPrice || maxPrice) {
        query.price = {};
        if (minPrice) query.price.$gte = Number(minPrice);
        if (maxPrice) query.price.$lte = Number(maxPrice);
      }
      if (availability === "available") query.quantity = { $gt: 0 };
      if (availability === "unavailable") query.quantity = { $lte: 0 };

      let sortOption = { createdAt: -1 };
      if (sort === "price-asc") sortOption = { price: 1 };
      if (sort === "price-desc") sortOption = { price: -1 };

      const pageNum = Number(page);
      const limitNum = Number(limit);

      const total = await equipmentCollection.countDocuments(query);
      const equipment = await equipmentCollection
        .find(query)
        .sort(sortOption)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .toArray();

      res.send({
        equipment,
        total,
        totalPages: Math.ceil(total / limitNum),
      });
    });

    // Admin: approve / reject
    app.patch(
      "/equipment/:id/status",
      verifyToken,
      verifyAdmin,
      async (req, res) => {
        const { status } = req.body;
        if (!["pending", "approved", "rejected"].includes(status)) {
          return res.status(400).send({ message: "Invalid status" });
        }
        const result = await equipmentCollection.updateOne(
          { _id: new ObjectId(req.params.id) },
          { $set: { status } }
        );
        res.send(result);
      }
    );

    // Details (private)
    app.get("/equipment/:id", verifyToken, async (req, res) => {
      try {
        const result = await equipmentCollection.findOne({
          _id: new ObjectId(req.params.id),
        });
        if (!result) return res.status(404).send({ message: "Not found" });
        res.send(result);
      } catch (error) {
        res.status(400).send({ message: "Invalid id" });
      }
    });

    // Update (owner নিজেরটা / admin যেকোনোটা)
    app.patch("/equipment/:id", verifyToken, canModify, async (req, res) => {
      const fields = [
        "name", "description", "category", "segment", "location", "price",
        "rentalType", "quantity", "condition", "brand", "model", "image", "terms",
      ];
      const updateDoc = {};
      fields.forEach((f) => {
        if (req.body[f] !== undefined) updateDoc[f] = req.body[f];
      });
      if (updateDoc.price !== undefined) updateDoc.price = Number(updateDoc.price);
      if (updateDoc.quantity !== undefined)
        updateDoc.quantity = Number(updateDoc.quantity);
      const result = await equipmentCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: updateDoc }
      );
      res.send(result);
    });

    // Delete (owner নিজেরটা / admin যেকোনোটা)
    app.delete("/equipment/:id", verifyToken, canModify, async (req, res) => {
      const result = await equipmentCollection.deleteOne({
        _id: new ObjectId(req.params.id),
      });
      res.send(result);
    });
  } catch (error) {
    console.error("MongoDB connection failed:", error.message);
  }
}
run();

app.get("/", (req, res) => {
  res.send("NoiROBO server is running");
});

app.listen(port, () => {
  console.log(`Server running on port ${port}`);
});