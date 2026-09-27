import { db, UserRecord } from "@/infrastructure/db";
import { NotFoundError, ValidationError } from "@/lib/errors";

export class UserService {
  public static getUserById(id: string): UserRecord {
    const user = db.findUserById(id);
    if (!user) {
      throw new NotFoundError("User", id);
    }
    return user;
  }

  public static getUserByEmail(email: string): UserRecord | undefined {
    return db.findUserByEmail(email);
  }

  public static updateUserStatus(userId: string, status: "ACTIVE" | "INVITED" | "SUSPENDED" | "DEACTIVATED"): UserRecord {
    const updated = db.updateUser(userId, { status });
    if (!updated) {
      throw new NotFoundError("User", userId);
    }
    return updated;
  }

  public static updateProfile(userId: string, updates: { name?: string; avatar?: string }): UserRecord {
    if (updates.name && updates.name.trim().length < 2) {
      throw new ValidationError("Name must be at least 2 characters.");
    }
    const updated = db.updateUser(userId, updates);
    if (!updated) {
      throw new NotFoundError("User", userId);
    }
    return updated;
  }
}
