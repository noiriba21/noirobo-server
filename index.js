const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();
const express = require("express");
const cors = require("cors");
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
    console.log("MongoDB connected successfully");

    // নতুন equipment যোগ করা (পরে শুধু Owner পারবে)
    app.post("/equipment", async (req, res) => {
      const equipment = req.body;
      equipment.status = "pending";
      equipment.createdAt = new Date();
      const result = await equipmentCollection.insertOne(equipment);
      res.send(result);
    });

    // Home page-এর জন্য ৬টা approved equipment
    app.get("/equipment/featured", async (req, res) => {
      const result = await equipmentCollection
        .find({ status: "approved" })
        .sort({ createdAt: -1 })
        .limit(6)
        .toArray();
      res.send(result);
    });

    // সব approved equipment (সার্চ, ফিল্টার, সর্ট, pagination)
    app.get("/equipment", async (req, res) => {
      const {
        search,
        category,
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

    // একটা equipment-এর details
    app.get("/equipment/:id", async (req, res) => {
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