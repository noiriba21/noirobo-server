const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);
require("dotenv").config();
const { MongoClient } = require("mongodb");

const q = "?auto=compress&cs=tinysrgb&w=800";

// যেটার লিংক নেই সেটা ফাঁকা রাখো, ওটা বদলাবে না
const images = {
  "EV Battery Tester": "https://images.pexels.com/photos/38292956/pexels-photo-38292956.jpeg" + q,
  "Tire Changer Machine": "https://images.pexels.com/photos/5260115/pexels-photo-5260115.jpeg" + q,
  "Engine Hoist": "https://images.pexels.com/photos/38472923/pexels-photo-38472923.jpeg" + q,
  "Welding Machine": "https://images.pexels.com/photos/41058214/pexels-photo-41058214.jpeg" + q,
  "Car Jack & Stand Set": "https://images.pexels.com/photos/15397793/pexels-photo-15397793.jpeg" + q,
  "Paint Spray Gun Kit": "https://images.pexels.com/photos/31759140/pexels-photo-31759140.jpeg" + q,
  "Laser Cutter": "https://images.pexels.com/photos/17180807/pexels-photo-17180807.jpeg" + q,
  "3D Printer": "https://images.pexels.com/photos/17509939/pexels-photo-17509939.jpeg" + q,
  "Camera Vision Module": "https://images.pexels.com/photos/38361202/pexels-photo-38361202.jpeg" + q,
  "Arduino Starter Kit": "https://images.pexels.com/photos/39712877/pexels-photo-39712877.jpeg" + q,
  "Raspberry Pi 5 Kit": "https://images.pexels.com/photos/10635975/pexels-photo-10635975.jpeg" + q,
  "Robot Arm Kit 6-DOF": "https://images.pexels.com/photos/8438874/pexels-photo-8438874.jpeg" + q,
  "Camera Drone": "https://images.pexels.com/photos/12205968/pexels-photo-12205968.jpeg" + q,
  "NVIDIA Jetson Nano": "https://images.pexels.com/photos/6636497/pexels-photo-6636497.jpeg" + q,
  "Lidar Sensor Set": "https://images.pexels.com/photos/7254411/pexels-photo-7254411.jpeg" + q,
  "OBD2 Car Scanner": "https://images.pexels.com/photos/4116193/pexels-photo-4116193.jpeg" + q,
};

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const col = client.db("noiroboDB").collection("equipment");
    let done = 0;
    for (const [name, image] of Object.entries(images)) {
      if (!image.trim()) continue;
      const r = await col.updateMany(
        { name, seeded: true },
        { $set: { image: image.trim() } }
      );
      console.log(`${name}: ${r.matchedCount ? "updated" : "NOT FOUND"}`);
      done += r.matchedCount;
    }
    console.log(`\n${done} equipment updated`);
  } finally {
    await client.close();
  }
}
main();