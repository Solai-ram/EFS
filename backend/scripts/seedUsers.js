/**
 * Seeds hospital departments and routing services (from src/hospital.js) and initial admin/staff users.
 * Run from backend folder: npm run seed
 *
 * Departments and services: skips names already in the database (idempotent).
 * Users: creates admin/staff only if those usernames do not exist.
 *
 * Configure SEED_* vars in .env (see .env.example).
 */
import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import { fileURLToPath } from "url";
import path from "path";
import { HOSPITAL_DEPARTMENTS, HOSPITAL_SERVICES } from "./data/hospitalDepartments.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const MONGODB_URI =
  process.env.MONGODB_URI || "mongodb://localhost:27017/feedbacksystem";

const departmentSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, unique: true },
    description: { type: String, default: "", trim: true },
  },
  { timestamps: true }
);

const userSchema = new mongoose.Schema(
  {
    username: {
      type: String,
      required: true,
      trim: true,
      unique: true,
      lowercase: true,
    },
    passwordHash: { type: String, required: true },
    role: { type: String, enum: ["admin", "staff"], required: true },
    departmentId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Department",
      default: null,
    },
  },
  { timestamps: true }
);

const Department =
  mongoose.models.Department || mongoose.model("Department", departmentSchema);
const User = mongoose.models.User || mongoose.model("User", userSchema);
const RoutingService =
  mongoose.models.RoutingService ||
  mongoose.model(
    "RoutingService",
    new mongoose.Schema(
      {
        name: { type: String, required: true, trim: true, unique: true },
        description: { type: String, default: "", trim: true },
      },
      { timestamps: true }
    )
  );

async function main() {
  const adminUsername = (process.env.SEED_ADMIN_USERNAME || "admin").trim().toLowerCase();
  const adminPassword = process.env.SEED_ADMIN_PASSWORD || "admin123";
  // The built-in demo password must never reach a real server.
  if (process.env.NODE_ENV === "production" && (adminPassword === "admin123" || adminPassword.length < 8)) {
    throw new Error(
      "Set SEED_ADMIN_PASSWORD in backend/.env to a strong password (8+ characters, not the demo one) before seeding in production."
    );
  }

  await mongoose.connect(MONGODB_URI);
  const salt = await bcrypt.genSalt(10);

  const existing = await Department.find().select("name").lean();
  const existingNames = new Set(
    existing.map((d) => String(d.name).trim().toLowerCase())
  );
  const toInsert = HOSPITAL_DEPARTMENTS.filter(
    (d) => !existingNames.has(String(d.name).trim().toLowerCase())
  );
  if (toInsert.length > 0) {
    await Department.insertMany(toInsert, { ordered: false });
  }
  console.log(
    `Departments: added ${toInsert.length} new (total in seed list: ${HOSPITAL_DEPARTMENTS.length}, already in DB: ${existing.length}).`
  );

  // Without services the AI cannot tag feedback with one, and service analytics stay empty.
  const existingServices = await RoutingService.find().select("name").lean();
  const serviceNames = new Set(existingServices.map((s) => String(s.name).trim().toLowerCase()));
  const servicesToInsert = HOSPITAL_SERVICES.filter(
    (s) => !serviceNames.has(String(s.name).trim().toLowerCase())
  );
  if (servicesToInsert.length > 0) {
    await RoutingService.insertMany(servicesToInsert, { ordered: false });
  }
  console.log(
    `Services: added ${servicesToInsert.length} new (total in seed list: ${HOSPITAL_SERVICES.length}, already in DB: ${existingServices.length}).`
  );

  let usersCreated = 0;

  const existingAdmin = await User.findOne({ username: adminUsername });
  if (!existingAdmin) {
    await User.create({
      username: adminUsername,
      passwordHash: await bcrypt.hash(adminPassword, salt),
      role: "admin",
      departmentId: null,
    });
    usersCreated += 1;
    console.log(`Created user: ${adminUsername} (admin)`);
  } else {
    console.log(`Skipped admin — "${adminUsername}" already exists`);
  }

  await mongoose.disconnect();
  console.log(
    usersCreated > 0
      ? `Done. Created ${usersCreated} new user(s).`
      : "Done. No new users."
  );
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
