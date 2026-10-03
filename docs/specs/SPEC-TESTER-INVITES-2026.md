# SPEC-TESTER-INVITES-2026 — Tester Invite Links & Test-Mode YooKassa Top-up Guard (Tier 1)

**Status:** Approved (2026-10-03) · **Tier:** 1 (Money / Auth / Database / Gateways)
**Scope:** Single-use 14-day tester invite links, YooKassa-exclusive test gateway, and test-mode top-up isolation.

---

## 1. Context & Problem Statement
The platform is operating in a closed testing phase where services are dispatched to **real providers** (HYBRID / Test Mode with test YooKassa keys), while production acquiring is not yet legally launched.
Without tester isolation, any visitor discovering the public funnel URL could sign up, trigger test YooKassa top-ups, and spend real platform funds on provider orders.
The platform requires:
1. Only YooKassa is active as a payment gateway (Robokassa, CryptoBot disabled).
2. Admin generates single-use tester invite links (e.g., batch of 10 links) valid for exactly **14 days**.
3. Each invite link is single-use and binds to one tester email upon redemption (`isTester = true`).
4. In test mode, top-ups and checkout payments are strictly restricted to verified testers (`isTester === true`) and platform staff (`OWNER`, `ADMIN`, `MANAGER`, `SUPPORT`).
5. Regular uninvited users in test mode receive a clear, user-friendly rejection message.

---

## 2. Invariants & Security Rules

| ID | Invariant | Enforcement |
|---|---|---|
| **INV-TESTER-01** | **Single-Use Atomicity:** A `TesterInvite` can only be redeemed once (`status: 'ACTIVE' -> 'USED'`). Concurrent redemption attempts must be protected by an atomic transaction (`updateMany` with `status: 'ACTIVE'`). | `redeemTesterInviteAction` (`db.$transaction`) |
| **INV-TESTER-02** | **14-Day Expiration:** An invite is invalid if `expiresAt < now()`. Expired invites cannot be redeemed. Default validity is strictly 14 days (`now() + 14 * 24 * 3600 * 1000`). | `redeemTesterInviteAction` |
| **INV-TESTER-03** | **One-Link-One-Email Binding:** Once redeemed, the invite records `usedById`, `usedEmail`, and sets `User.isTester = true`. | `TesterInvite` record + `User.isTester` |
| **INV-TESTER-04** | **Test-Mode Top-Up Guard:** If the tenant is in `isTestMode`, `createTopUpPaymentAction` and checkout payments strictly require `user.isTester === true` or staff role. Otherwise fails closed with a descriptive error. | `src/actions/user/top-up.action.ts`, `checkout-payment.service.ts` |
| **INV-TESTER-05** | **Gateway Whitelist (YooKassa Only):** `GatewaysAvailabilityService` and `PaymentGatewayFactory` expose only `yookassa` in user-facing checkout and add-funds interfaces during this phase. | `gateways-availability.service.ts` |
| **INV-TESTER-06** | **RBAC Governance:** Only `OWNER` and `ADMIN` can generate, list, revoke tester invites or manually toggle tester status on users. | `requireStaffPermission('clients', 'edit', ...)` |

---

## 3. Data Model

### 3.1 `User`
```prisma
model User {
  ...
  isTester Boolean @default(false)
  createdTesterInvites TesterInvite[] @relation("CreatedTesterInvites")
  usedTesterInvites    TesterInvite[] @relation("UsedTesterInvite")
}
```

### 3.2 `TesterInvite`
```prisma
model TesterInvite {
  id          String    @id @default(cuid())
  code        String    @unique
  tenantId    String    @default("smmplan")
  note        String?
  status      String    @default("ACTIVE") // ACTIVE, USED, REVOKED, EXPIRED
  expiresAt   DateTime
  createdById String?
  createdBy   User?     @relation("CreatedTesterInvites", fields: [createdById], references: [id])
  usedById    String?
  usedBy      User?     @relation("UsedTesterInvite", fields: [usedById], references: [id])
  usedEmail   String?
  usedAt      DateTime?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  @@index([code])
  @@index([status, expiresAt])
  @@index([tenantId])
}
```

---

## 4. Workflows & Architecture

### 4.1 Batch Link Generation (`generateTesterInvitesAction`)
1. Admin specifies count (default 10) and optional batch note.
2. Generates cryptographically secure random codes (`crypto.randomBytes(16).toString('hex')`).
3. Sets `expiresAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000)`.
4. Saves records in `TesterInvite`.
5. Returns full URLs for convenient one-click clipboard copying.

### 4.2 Redemption Flow (`/invite/[code]`)
1. User navigates to `/invite/[code]`.
2. System validates code existence and expiration.
3. If user is not authenticated: redirect to `/login?redirect=/invite/[code]` (or register).
4. If user is authenticated:
   - Run atomic transaction:
     ```ts
     const updated = await tx.testerInvite.updateMany({
       where: { code, status: 'ACTIVE', expiresAt: { gt: new Date() } },
       data: { status: 'USED', usedById: user.id, usedEmail: user.email, usedAt: new Date() }
     });
     if (updated.count !== 1) throw new Error("Invite invalid or already used");
     await tx.user.update({ where: { id: user.id }, data: { isTester: true } });
     ```
5. Displays successful activation and redirects to `/dashboard/add-funds`.

### 4.3 Top-Up Guard
1. When user requests `createTopUpPaymentAction`:
   - Checks `const isTestMode = await SettingsProvider.isTestMode(targetTenantId)`.
   - If `isTestMode === true`:
     - Checks `if (!dbUser.isTester && !['ADMIN', 'OWNER', 'MANAGER', 'SUPPORT'].includes(dbUser.role))` -> returns error:
       `"Тестовое пополнение баланса доступно только авторизованным тестировщикам по персональной ссылке-приглашению."`.
