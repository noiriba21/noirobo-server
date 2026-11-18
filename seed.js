const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);
require("dotenv").config();
const { MongoClient } = require("mongodb");

const img = (text) =>
  `https://placehold.co/600x400/0B3D91/ffffff?text=${encodeURIComponent(text)}`;

const make = (name, segment, category, price, rentalType, quantity, brand, model, condition) => ({
  name,
  description: `${name} available for rent. Well maintained and tested, ideal for students, makers and workshops.`,
  segment,
  category,
  location: "Chattogram",
  price,
  rentalType,
  quantity,
  condition,
  brand,
  model,
  image: img(name),
  terms: "Valid ID required. Return in the same condition. Late return and damage charges apply.",
  status: "approved",
  ownerName: "NoiROBO Demo Owner",
  ownerEmail: "owner@noirobo.com",
  seeded: true,
  createdAt: new Date(),
});

const items = [
  make("Arduino Starter Kit", "robot", "Robotics & Electronics", 150, "Daily", 12, "Arduino", "UNO R3", "New"),
  make("Raspberry Pi 5 Kit", "robot", "Robotics & Electronics", 400, "Daily", 8, "Raspberry Pi", "Pi 5 8GB", "New"),
  make("Robot Arm Kit 6-DOF", "robot", "Robotics & Electronics", 2500, "Weekly", 4, "Adeept", "6-DOF Arm", "Like New"),
  make("Lidar Sensor Set", "robot", "Robotics & Electronics", 300, "Daily", 10, "Slamtec", "RPLidar A1", "Good"),
  make("Camera Drone", "robot", "Robotics & Electronics", 1200, "Daily", 5, "DJI", "Mini 3", "Like New"),
  make("NVIDIA Jetson Nano", "robot", "AI & ML Hardware", 600, "Weekly", 6, "NVIDIA", "Jetson Nano 4GB", "Good"),
  make("Camera Vision Module", "robot", "AI & ML Hardware", 250, "Daily", 9, "Arducam", "12MP Module", "New"),
  make("3D Printer", "robot", "3D Printing & Fabrication", 1800, "Monthly", 3, "Creality", "Ender 3 V3", "Good"),
  make("Laser Cutter", "robot", "3D Printing & Fabrication", 3500, "Monthly", 2, "xTool", "D1 Pro", "Like New"),
  make("OBD2 Car Scanner", "car", "Vehicles & Car Tools", 500, "Daily", 7, "Launch", "X431", "Good"),
  make("Paint Spray Gun Kit", "car", "Vehicles & Car Tools", 400, "Daily", 6, "Devilbiss", "HVLP Kit", "Good"),
  make("Car Jack & Stand Set", "car", "Car Workshop Equipment", 300, "Daily", 10, "Total", "3 Ton Set", "Good"),
  make("Welding Machine", "car", "Car Workshop Equipment", 800, "Daily", 4, "Lincoln", "Inverter 200A", "Like New"),
  make("Engine Hoist", "car", "Car Workshop Equipment", 1000, "Daily", 3, "Torin", "2 Ton Hoist", "Good"),
  make("Tire Changer Machine", "car", "Car Workshop Equipment", 2000, "Weekly", 2, "Hofmann", "Monty 3300", "Good"),
  make("EV Battery Tester", "car", "EV & Battery Tools", 1500, "Weekly", 3, "Fluke", "BT510", "New"),
];

async function seed() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const collection = client.db("noiroboDB").collection("equipment");
    await collection.deleteMany({ seeded: true });
    const result = await collection.insertMany(items);
    console.log(`${result.insertedCount} equipment added`);
  } catch (error) {
    console.error("Seed failed:", error.message);
  } finally {
    await client.close();
  }
}
seed();