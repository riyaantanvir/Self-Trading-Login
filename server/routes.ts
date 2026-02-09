import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { setupAuth, hashPassword } from "./auth";
import { insertTradeSchema } from "@shared/schema";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express,
): Promise<Server> {
  setupAuth(app);

  // Seed Admin User
  const existingAdmin = await storage.getUserByUsername("Admin");
  if (!existingAdmin) {
    const hashedPassword = await hashPassword("Admin");
    await storage.createUser({
      username: "Admin",
      password: hashedPassword,
      isAdmin: true,
    });
    console.log("Admin user created");
  }

  // Trades API
  app.get("/api/trades", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    const trades = await storage.getTrades();
    res.json(trades);
  });

  app.post("/api/trades", async (req, res) => {
    if (!req.isAuthenticated()) return res.sendStatus(401);
    
    try {
      const data = insertTradeSchema.parse(req.body);
      const trade = await storage.createTrade({
        ...data,
        userId: req.user!.id,
      });
      res.status(201).json(trade);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json(e.errors);
      } else {
        res.status(500).json({ message: "Internal server error" });
      }
    }
  });

  return httpServer;
}
