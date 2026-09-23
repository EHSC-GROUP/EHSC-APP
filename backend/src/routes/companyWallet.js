import { Router } from "express";
import { ROLES } from "../lib/constants.js";
import { authenticate, requireApprover } from "../middleware/auth.js";
import { round2 } from "../lib/dateUtils.js";
import { getCompanyWalletBalance, topUpWallet, listWalletTransactions } from "../lib/companyWallet.js";

const router = Router();

// Visible to any approver (admin/superadmin/team lead) — the whole point is
// to show it at every stage of the approval chain, not just the final one.
router.get("/balance", authenticate, requireApprover, async (req, res, next) => {
  try {
    res.json({ balance: await getCompanyWalletBalance() });
  } catch (err) {
    next(err);
  }
});

router.get("/transactions", authenticate, requireApprover, async (req, res, next) => {
  try {
    res.json(await listWalletTransactions());
  } catch (err) {
    next(err);
  }
});

router.post("/topup", authenticate, requireApprover, async (req, res, next) => {
  try {
    if (req.user.role !== ROLES.SUPERADMIN) {
      return res.status(403).json({ error: "Only the superadmin can top up the company wallet" });
    }
    const amount = round2(Number(req.body.amount));
    if (!(amount > 0)) return res.status(400).json({ error: "amount must be greater than 0" });
    const note = req.body.note ? String(req.body.note).trim() : null;
    const balance = await topUpWallet({ amount, note, userId: req.user.userId });
    res.json({ ok: true, balance });
  } catch (err) {
    next(err);
  }
});

export default router;
