const dns = require("node:dns");
dns.setServers(["8.8.8.8", "8.8.4.4"]);
require("dotenv").config();
const { MongoClient } = require("mongodb");

async function main() {
  const [email, role] = process.argv.slice(2);
  const client = new MongoClient(process.env.MONGODB_URI);
  try {
    await client.connect();
    const db = client.db("noiroboDB");
    const login = db.collection("user");
    const profiles = db.collection("users");

    // কিছু না দিলে সবার তালিকা দেখাবে
    if (!email) {
      const all = await login.find().toArray();
      console.log("\nRegistered login accounts:");
      for (const u of all) {
        const p = await profiles.findOne({ email: String(u.email).toLowerCase() });
        console.log(` - ${u.email}  |  role: ${p ? p.role : "(none yet)"}`);
      }
      console.log("\nUse: node makeRole.js email@example.com admin|owner|customer\n");
      return;
    }

    if (!["admin", "owner", "customer"].includes(role)) {
      console.log("Role must be admin, owner or customer");
      return;
    }

    const e = email.toLowerCase();
    const acc = await login.findOne({ email: e });
    if (!acc) {
      console.log(`No login account found for ${e}. Register it on the website first.`);
      return;
    }

    await profiles.updateOne(
      { email: e },
      {
        $set: { role },
        $setOnInsert: {
          name: acc.name || "",
          email: e,
          photo: acc.image || "",
          phone: "",
          address: "",
          createdAt: new Date(),
        },
      },
      { upsert: true }
    );
    console.log(`Done: ${e} is now ${role}`);
  } finally {
    await client.close();
  }
}
main();