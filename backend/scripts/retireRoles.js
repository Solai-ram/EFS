/**
 * Retire the roles the EFS no longer uses (Management, Head of Department, Staff).
 *
 * EFS has only Super Admin and Admin. A database that was created by the old patient-feedback app
 * (or by an earlier version of this one) still has the other roles and accounts that hold them.
 *
 *   npm run retire-roles           lists the accounts and roles that would be removed
 *   npm run retire-roles -- --yes  removes them
 *
 * With --yes this deletes those user accounts and roles, clears any ticket assignment that pointed
 * at them (the tickets themselves are kept), and removes their department / service mappings.
 */
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const { Department, Feedback, Role, RoutingService, User, mongoose } = await import("../src/models.js");

const RETIRED = ["management", "hod", "staff"];
const MONGODB_URI = process.env.MONGODB_URI || "mongodb://localhost:27017/feedbacksystem";
const apply = process.argv.includes("--yes");

await mongoose.connect(MONGODB_URI);
console.log("[retire-roles] database:", mongoose.connection.db.databaseName);

const users = await User.find({ role: { $in: RETIRED } }).select("username role").lean();
const roles = await Role.find({ key: { $in: RETIRED } }).select("key label").lean();
const assigned = await Feedback.countDocuments({ assignedToUserId: { $in: users.map((u) => u._id) } });

console.log(`Accounts with a retired role: ${users.length}`);
for (const u of users) console.log(`  - ${u.username} (${u.role})`);
console.log(`Retired roles still in the database: ${roles.map((r) => r.key).join(", ") || "none"}`);
console.log(`Tickets assigned to those accounts: ${assigned}`);

if (!apply) {
  console.log("\nNothing changed. Run again with --yes to remove them.");
  await mongoose.disconnect();
  process.exit(0);
}

const ids = users.map((u) => u._id);
await Feedback.updateMany(
  { assignedToUserId: { $in: ids } },
  { $set: { assignedToUserId: null, assignedToUsername: "", assignedAt: null } }
);
await Department.updateMany({ hodUserId: { $in: ids } }, { $set: { hodUserId: null } });
await RoutingService.updateMany({ hodUserId: { $in: ids } }, { $set: { hodUserId: null } });
const removedUsers = await User.deleteMany({ _id: { $in: ids } });
const removedRoles = await Role.deleteMany({ key: { $in: RETIRED } });
console.log(`\nRemoved ${removedUsers.deletedCount} account(s) and ${removedRoles.deletedCount} role(s).`);
await mongoose.disconnect();
process.exit(0);
