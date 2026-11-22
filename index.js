const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);

require("dotenv").config();
const express = require("express");
const cors = require("cors");
const jwt = require("jsonwebtoken");
const Stripe = require("stripe");
const { MongoClient, ObjectId } = require("mongodb");

const app = express();
const port = process.env.PORT || 5000;

app.use(cors());
app.use(express.json());

const stripe = process.env.STRIPE_SECRET_KEY
  ? new Stripe(process.env.STRIPE_SECRET_KEY)
  : null;

const client = new MongoClient(process.env.MONGODB_URI);
const db = client.db("noiroboDB");
const usersCollection = db.collection("users");
const equipmentCollection = db.collection("equipment");
const favoritesCollection = db.collection("favorites");
const bookingsCollection = db.collection("bookings");
const paymentsCollection = db.collection("payments");

const CLIENT_URL = process.env.CLIENT_URL || "http://localhost:3000";
const ADMIN_EMAIL = (process.env.ADMIN_EMAIL || "").toLowerCase();
const BDT_PER_USD = 120;

usersCollection.createIndex({ email: 1 }, { unique: true }).catch(() => {});
bookingsCollection
  .createIndex({ sessionId: 1 }, { unique: true, sparse: true })
  .catch(() => {});
paymentsCollection
  .createIndex({ sessionId: 1 }, { unique: true, sparse: true })
  .catch(() => {});

// ================= HELPERS =================
const toId = (id) => {
  try {
    return new ObjectId(id);
  } catch {
    return null;
  }
};

const calcDays = (start, end) =>
  Math.round((new Date(end) - new Date(start)) / 86400000) + 1;

const calcAmount = (item, days, qty) => {
  const units =
    item.rentalType === "Weekly"
      ? Math.ceil(days / 7)
      : item.rentalType === "Monthly"
      ? Math.ceil(days / 30)
      : days;
  return item.price * units * qty;
};

const getAvailable = async (item, start, end) => {
  const overlapping = await bookingsCollection
    .find({
      equipmentId: String(item._id),
      bookingStatus: "confirmed",
      startDate: { $lte: end },
      endDate: { $gte: start },
    })
    .toArray();
  const used = overlapping.reduce((sum, b) => sum + b.quantity, 0);
  return item.quantity - used;
};

// ================= MIDDLEWARES =================
const verifyToken = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith("Bearer ")) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const decoded = jwt.verify(header.split(" ")[1], process.env.JWT_SECRET);
    const email = String(decoded.email).toLowerCase();

    let user = await usersCollection.findOne({ email });
    if (!user) {
      const doc = {
        name: decoded.name || "",
        email,
        photo: decoded.photo || "",
        role: email === ADMIN_EMAIL ? "admin" : "customer",
        phone: "",
        address: "",
        createdAt: new Date(),
      };
      try {
        await usersCollection.insertOne(doc);
        user = doc;
      } catch {
        user = await usersCollection.findOne({ email });
      }
    } else if (email === ADMIN_EMAIL && user.role !== "admin") {
      await usersCollection.updateOne({ email }, { $set: { role: "admin" } });
      user.role = "admin";
    }

    req.decoded = decoded;
    req.user = user;
    next();
  } catch {
    res.status(401).send({ message: "unauthorized access" });
  }
};

const allow = (...roles) => (req, res, next) =>
  roles.includes(req.user && req.user.role)
    ? next()
    : res.status(403).send({ message: "forbidden access" });

const verifyRenter = allow("customer");
const verifyOwner = allow("owner");
const verifyAdmin = allow("admin");

const canModify = async (req, res, next) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(400).send({ message: "Invalid id" });
  const item = await equipmentCollection.findOne({ _id });
  if (!item) return res.status(404).send({ message: "Not found" });
  if (req.user.role !== "admin" && item.ownerEmail !== req.user.email) {
    return res.status(403).send({ message: "forbidden access" });
  }
  req.item = item;
  next();
};

// ================= USERS =================
app.get("/users/me", verifyToken, (req, res) => res.send(req.user));

app.patch("/users/me", verifyToken, async (req, res) => {
  const { name, photo, phone, address } = req.body;
  const updateDoc = {};
  if (name !== undefined) updateDoc.name = name;
  if (photo !== undefined) updateDoc.photo = photo;
  if (phone !== undefined) updateDoc.phone = phone;
  if (address !== undefined) updateDoc.address = address;
  res.send(
    await usersCollection.updateOne(
      { email: req.user.email },
      { $set: updateDoc }
    )
  );
});

app.get("/users", verifyToken, verifyAdmin, async (req, res) => {
  res.send(await usersCollection.find().sort({ createdAt: -1 }).toArray());
});

app.patch("/users/:id/role", verifyToken, verifyAdmin, async (req, res) => {
  const { role } = req.body;
  const _id = toId(req.params.id);
  if (!_id || !["customer", "owner", "admin"].includes(role)) {
    return res.status(400).send({ message: "Invalid request" });
  }
  res.send(await usersCollection.updateOne({ _id }, { $set: { role } }));
});

// ================= EQUIPMENT =================
app.post("/equipment", verifyToken, verifyOwner, async (req, res) => {
  const b = req.body;
  if (!b.name || !(Number(b.price) > 0) || !(Number(b.quantity) >= 0)) {
    return res.status(400).send({ message: "Invalid equipment data" });
  }
  const equipment = {
    name: b.name,
    description: b.description,
    category: b.category,
    segment: b.segment === "car" ? "car" : "robot",
    location: b.location,
    price: Number(b.price),
    rentalType: b.rentalType,
    quantity: Number(b.quantity),
    condition: b.condition,
    brand: b.brand,
    model: b.model,
    image: b.image,
    terms: b.terms,
    ownerEmail: req.user.email,
    ownerName: req.user.name,
    ownerPhoto: req.user.photo || "",
    status: "pending",
    createdAt: new Date(),
  };
  res.send(await equipmentCollection.insertOne(equipment));
});

app.get("/equipment/featured", async (req, res) => {
  const { segment, limit = 6 } = req.query;
  const query = { status: "approved" };
  if (segment) query.segment = segment;
  res.send(
    await equipmentCollection
      .find(query)
      .sort({ createdAt: -1 })
      .limit(Number(limit))
      .toArray()
  );
});

app.get("/equipment/mine", verifyToken, verifyOwner, async (req, res) => {
  res.send(
    await equipmentCollection
      .find({ ownerEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray()
  );
});

app.get("/admin/equipment", verifyToken, verifyAdmin, async (req, res) => {
  res.send(
    await equipmentCollection.find().sort({ createdAt: -1 }).toArray()
  );
});

app.get("/equipment", async (req, res) => {
  const {
    search, category, segment, rentalType, minPrice, maxPrice,
    availability, sort, page = 1, limit = 9,
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

  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.max(1, Number(limit));

  const total = await equipmentCollection.countDocuments(query);
  const equipment = await equipmentCollection
    .find(query)
    .sort(sortOption)
    .skip((pageNum - 1) * limitNum)
    .limit(limitNum)
    .toArray();

  res.send({ equipment, total, totalPages: Math.ceil(total / limitNum) });
});

app.patch("/equipment/:id/status", verifyToken, verifyAdmin, async (req, res) => {
  const { status } = req.body;
  const _id = toId(req.params.id);
  if (!_id || !["pending", "approved", "rejected"].includes(status)) {
    return res.status(400).send({ message: "Invalid request" });
  }
  res.send(await equipmentCollection.updateOne({ _id }, { $set: { status } }));
});

app.get("/equipment/:id", verifyToken, async (req, res) => {
  const _id = toId(req.params.id);
  if (!_id) return res.status(400).send({ message: "Invalid id" });
  const item = await equipmentCollection.findOne({ _id });
  if (!item) return res.status(404).send({ message: "Not found" });
  const privileged =
    req.user.role === "admin" || item.ownerEmail === req.user.email;
  if (item.status !== "approved" && !privileged) {
    return res.status(404).send({ message: "Not found" });
  }
  res.send(item);
});

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
  res.send(
    await equipmentCollection.updateOne({ _id: req.item._id }, { $set: updateDoc })
  );
});

app.delete("/equipment/:id", verifyToken, canModify, async (req, res) => {
  res.send(await equipmentCollection.deleteOne({ _id: req.item._id }));
});

// ================= FAVORITES =================
app.post("/favorites", verifyToken, async (req, res) => {
  const { equipmentId } = req.body;
  if (!toId(equipmentId)) return res.status(400).send({ message: "Invalid id" });
  const exists = await favoritesCollection.findOne({
    email: req.user.email,
    equipmentId,
  });
  if (!exists) {
    await favoritesCollection.insertOne({
      email: req.user.email,
      equipmentId,
      createdAt: new Date(),
    });
  }
  res.send({ ok: true });
});

app.get("/favorites/ids", verifyToken, async (req, res) => {
  const favs = await favoritesCollection.find({ email: req.user.email }).toArray();
  res.send(favs.map((f) => f.equipmentId));
});

app.get("/favorites", verifyToken, async (req, res) => {
  const favs = await favoritesCollection.find({ email: req.user.email }).toArray();
  const ids = favs.map((f) => toId(f.equipmentId)).filter(Boolean);
  res.send(await equipmentCollection.find({ _id: { $in: ids } }).toArray());
});

app.delete("/favorites/:equipmentId", verifyToken, async (req, res) => {
  res.send(
    await favoritesCollection.deleteOne({
      email: req.user.email,
      equipmentId: req.params.equipmentId,
    })
  );
});

// ================= PAYMENT & BOOKING =================
app.post("/create-checkout-session", verifyToken, verifyRenter, async (req, res) => {
  try {
    if (!stripe) return res.status(500).send({ message: "Stripe is not configured" });

    const { equipmentId, startDate, endDate, quantity, phone, address, notes } = req.body;
    const _id = toId(equipmentId);
    const qty = Number(quantity);
    const today = new Date().toISOString().slice(0, 10);

    if (!_id || !startDate || !endDate || !phone || !address) {
      return res.status(400).send({ message: "Please fill all required fields" });
    }
    if (startDate < today) {
      return res.status(400).send({ message: "Start date cannot be in the past" });
    }
    if (endDate < startDate) {
      return res.status(400).send({ message: "End date must be after start date" });
    }
    if (!Number.isInteger(qty) || qty < 1) {
      return res.status(400).send({ message: "Invalid quantity" });
    }

    const item = await equipmentCollection.findOne({ _id, status: "approved" });
    if (!item) return res.status(404).send({ message: "Equipment not found" });

    const available = await getAvailable(item, startDate, endDate);
    if (qty > available) {
      return res.status(400).send({
        message: `Only ${Math.max(0, available)} unit(s) available for these dates`,
      });
    }

    const days = calcDays(startDate, endDate);
    const amount = calcAmount(item, days, qty);
    const cents = Math.max(50, Math.round((amount / BDT_PER_USD) * 100));

    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      customer_email: req.user.email,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: "usd",
            unit_amount: cents,
            product_data: {
              name: `${item.name} (${days} day${days > 1 ? "s" : ""}, qty ${qty})`,
            },
          },
        },
      ],
      metadata: {
        equipmentId: String(item._id),
        startDate,
        endDate,
        quantity: String(qty),
        phone: String(phone).slice(0, 40),
        address: String(address).slice(0, 300),
        notes: String(notes || "").slice(0, 300),
        email: req.user.email,
      },
      success_url: `${CLIENT_URL}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${CLIENT_URL}/equipment/${item._id}`,
    });

    res.send({ url: session.url });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

app.post("/payments/confirm", verifyToken, async (req, res) => {
  try {
    if (!stripe) return res.status(500).send({ message: "Stripe is not configured" });
    const { sessionId } = req.body;
    if (!sessionId) return res.status(400).send({ message: "Session id required" });

    const existing = await bookingsCollection.findOne({ sessionId });
    if (existing) return res.send({ ok: true, bookingId: existing._id });

    const session = await stripe.checkout.sessions.retrieve(sessionId);
    if (session.payment_status !== "paid") {
      return res.status(400).send({ message: "Payment not completed" });
    }
    const m = session.metadata;
    if (m.email !== req.user.email) {
      return res.status(403).send({ message: "forbidden access" });
    }

    const item = await equipmentCollection.findOne({ _id: toId(m.equipmentId) });
    if (!item) return res.status(404).send({ message: "Equipment not found" });

    const qty = Number(m.quantity);
    const days = calcDays(m.startDate, m.endDate);
    const amount = calcAmount(item, days, qty);

    const booking = {
      sessionId,
      customerName: req.user.name,
      customerEmail: req.user.email,
      customerPhone: m.phone,
      deliveryAddress: m.address,
      notes: m.notes,
      equipmentId: String(item._id),
      equipmentName: item.name,
      equipmentImage: item.image,
      ownerName: item.ownerName || "NoiROBO Owner",
      ownerEmail: item.ownerEmail,
      startDate: m.startDate,
      endDate: m.endDate,
      days,
      quantity: qty,
      amount,
      paymentStatus: "paid",
      bookingStatus: "confirmed",
      createdAt: new Date(),
    };

    let bookingId;
    try {
      const result = await bookingsCollection.insertOne(booking);
      bookingId = result.insertedId;
    } catch (err) {
      if (err.code === 11000) {
        const dup = await bookingsCollection.findOne({ sessionId });
        return res.send({ ok: true, bookingId: dup._id });
      }
      throw err;
    }

    await paymentsCollection.insertOne({
      sessionId,
      transactionId: String(session.payment_intent),
      bookingId,
      customerEmail: req.user.email,
      ownerEmail: item.ownerEmail,
      equipmentId: String(item._id),
      amount,
      amountUSD: session.amount_total / 100,
      currency: session.currency,
      status: "paid",
      paidAt: new Date(),
    });

    res.send({ ok: true, bookingId });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});

// ================= BOOKINGS =================
app.get("/bookings/mine", verifyToken, async (req, res) => {
  res.send(
    await bookingsCollection
      .find({ customerEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray()
  );
});

app.get("/bookings/owner", verifyToken, verifyOwner, async (req, res) => {
  res.send(
    await bookingsCollection
      .find({ ownerEmail: req.user.email })
      .sort({ createdAt: -1 })
      .toArray()
  );
});

app.get("/bookings/all", verifyToken, verifyAdmin, async (req, res) => {
  res.send(await bookingsCollection.find().sort({ createdAt: -1 }).toArray());
});

app.patch("/bookings/:id/status", verifyToken, async (req, res) => {
  const { status } = req.body;
  const _id = toId(req.params.id);
  if (!_id || !["confirmed", "completed", "cancelled"].includes(status)) {
    return res.status(400).send({ message: "Invalid request" });
  }
  const booking = await bookingsCollection.findOne({ _id });
  if (!booking) return res.status(404).send({ message: "Not found" });
  if (req.user.role !== "admin" && booking.ownerEmail !== req.user.email) {
    return res.status(403).send({ message: "forbidden access" });
  }
  res.send(
    await bookingsCollection.updateOne({ _id }, { $set: { bookingStatus: status } })
  );
});

// ================= ANALYTICS =================
app.get("/analytics/admin", verifyToken, verifyAdmin, async (req, res) => {
  const [totalUsers, totalEquipment, totalBookings, pendingApprovals, completedRentals] =
    await Promise.all([
      usersCollection.countDocuments(),
      equipmentCollection.countDocuments(),
      bookingsCollection.countDocuments(),
      equipmentCollection.countDocuments({ status: "pending" }),
      bookingsCollection.countDocuments({ bookingStatus: "completed" }),
    ]);
  const revenue = await paymentsCollection
    .aggregate([{ $group: { _id: null, total: { $sum: "$amount" } } }])
    .toArray();
  const monthly = await bookingsCollection
    .aggregate([
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$createdAt" } },
          bookings: { $sum: 1 },
          revenue: { $sum: "$amount" },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  res.send({
    totalUsers,
    totalEquipment,
    totalBookings,
    pendingApprovals,
    completedRentals,
    totalRevenue: revenue[0] ? revenue[0].total : 0,
    monthly: monthly.map((m) => ({
      month: m._id,
      bookings: m.bookings,
      revenue: m.revenue,
    })),
  });
});

app.get("/analytics/owner", verifyToken, verifyOwner, async (req, res) => {
  const email = req.user.email;
  const [totalListed, completedRentals, totalBookings] = await Promise.all([
    equipmentCollection.countDocuments({ ownerEmail: email }),
    bookingsCollection.countDocuments({ ownerEmail: email, bookingStatus: "completed" }),
    bookingsCollection.countDocuments({ ownerEmail: email }),
  ]);
  const earnings = await paymentsCollection
    .aggregate([
      { $match: { ownerEmail: email } },
      { $group: { _id: null, total: { $sum: "$amount" } } },
    ])
    .toArray();
  const monthly = await paymentsCollection
    .aggregate([
      { $match: { ownerEmail: email } },
      {
        $group: {
          _id: { $dateToString: { format: "%Y-%m", date: "$paidAt" } },
          earnings: { $sum: "$amount" },
        },
      },
      { $sort: { _id: 1 } },
    ])
    .toArray();
  res.send({
    totalListed,
    completedRentals,
    totalBookings,
    totalEarnings: earnings[0] ? earnings[0].total : 0,
    monthly: monthly.map((m) => ({ month: m._id, earnings: m.earnings })),
  });
});

app.get("/", (req, res) => {
  res.send("NoiROBO server is running");
});

if (!process.env.VERCEL) {
  app.listen(port, () => console.log(`Server running on port ${port}`));
}

module.exports = app;