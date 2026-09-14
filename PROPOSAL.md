# Product Proposal: Zyrex ZK Governance (Private Voting dApp)

## 1. Product Overview & Target Users

### Product Overview
**Zyrex ZK Governance** is an upgraded, production-grade Zero-Knowledge Privacy-Preserving Voting Application built on the Midnight blockchain platform using Compact ZK smart contracts and a futuristic dark glassmorphic interface.

Traditional governance platforms (such as Snapshot, Tally, and legacy DAO voting dApps) require voters to sign public transactions with their wallet addresses. This public visibility links every wallet identity to its vote choice, creating severe real-world vulnerabilities including voter intimidation, vote buying/bribing, social pressure, and front-running/collusion.

Zyrex ZK Governance solves this fundamental trilemma—**Privacy vs. Auditability vs. Sybil/Double-Vote Resistance**—by utilizing client-side zero-knowledge proof generation via Compact zkSNARK circuits. Eligible voters construct cryptographic proofs locally inside their browser. The Midnight blockchain verifiably tallies ballots on-chain without ever receiving or exposing the voter's identity, public key, or individual ballot selection.

### Target Users & Use Cases
1. **Decentralized Autonomous Organizations (DAOs)**: Protocol DAOs requiring secret ballot voting for treasury allocations, core developer grants, and sensitive governance decisions to eliminate whales influencing voters.
2. **Corporate & Enterprise Boardroom Elections**: Enterprise stakeholders casting confidential shareholder votes where legally compliance demands secret ballots with auditability.
3. **High-Stakes Grant Allocations**: Grants councils evaluating funding proposals without bias, peer pressure, or public signaling effects.
4. **Community Surveys & Privacy-Conscious Polls**: Ecosystem projects gathering honest community sentiment on contentious protocol parameters.

---

## 2. Why Midnight? (Privacy & Selective Disclosure)

Midnight is uniquely engineered for privacy-preserving dApps through its dual-state model, Compact zero-knowledge programming language, and selective disclosure capabilities.

### Key Reasons for Building on Midnight:
- **Client-Side Shielded Witness Execution**: Midnight enables execution of private circuits client-side. Secret inputs (voter private key, vote choice) remain in local memory and are converted into lightweight zero-knowledge proofs before transmission.
- **Selective Disclosure Capabilities**: Unlike fully transparent ledgers (Ethereum, Cardano public contracts) or fully opaque ledgers (Monero), Midnight enables programmable selective disclosure. The contract proves correctness to the public ledger while selectively concealing private data.
- **Deterministic Nullifiers**: Midnight natively supports stateful nullifier sets. By recording cryptographic nullifiers on-chain, Midnight mathematically prevents double-voting without tracking which address submitted the transaction.
- **Compact Language Ergonomics**: Midnight's Compact smart contract language simplifies ZK circuit construction, automatically generating proving/verifying key material and indexer data structures.

---

## 3. Data Model (Private State vs. Public Ledger State)

The system strictly segregates confidential local data from transparent on-chain ledger state:

```
┌─────────────────────────────────────────────────────────┐
│              PRIVATE STATE (Client-Side)                │
├─────────────────────────────────────────────────────────┤
│ • voterSecretKey : Uint8Array[32] (Local Entropy)       │
│ • voteChoice     : Boolean (True = YES, False = NO)     │
│ • adminSecretKey : Uint8Array[32] (Admin Authority Key) │
└────────────────────────────┬────────────────────────────┘
                             │
                  Constructs zkSNARK Proof
                             │
                             ▼
┌─────────────────────────────────────────────────────────┐
│              PUBLIC STATE (Midnight Ledger)             │
├─────────────────────────────────────────────────────────┤
│ • proposalId      : Bytes[32] (Unique Proposal Hash)    │
│ • proposalText    : String (Proposal Title & Details)   │
│ • yesTally        : Uint64 (Total YES Vote Counter)     │
│ • noTally         : Uint64 (Total NO Vote Counter)      │
│ • votingOpen      : Boolean (Active / Closed Status)    │
│ • adminCommitment : Bytes[32] (SHA-256 Hash of Admin SK)│
│ • nullifierSet    : Set<Bytes[32]> (Spent Nullifiers)   │
└─────────────────────────────────────────────────────────┘
```

### Deterministic Nullifier Formula:
$$\text{nullifier} = \text{SHA-256}(\text{voterSecretKey} \mathbin{\Vert} \text{proposalId})$$

- **Private Witness**: `voterSecretKey` and `voteChoice` are passed into circuit execution in client memory.
- **Public Proof Payload**: The generated zkSNARK proof proves:
  1. The voter possesses a valid 256-bit secret key.
  2. The derived nullifier is computed correctly.
  3. The nullifier is not present in the on-chain `nullifierSet` (Membership Guard).
  4. The vote tally accumulator is incremented by exactly 1.

---

## 4. Level Scope & Implementation Architecture

### Completed Hackathon Scope (Level 3 / Level 6):
1. **Compact ZK Circuit & Contract (`contracts/voting.compact`)**:
   - Written in Compact v0.31.1 / v0.5.1, compiled into ZKIR, prover keys, and verifier keys.
   - Circuit guards enforce single-vote per secret key via nullifier tracking and restrict administrative closure to verified admin commitments.
2. **Vitest Unit Test Suite (`test/voting.test.ts`, `tests/voting.test.ts`, `src/test/voting.test.ts`)**:
   - 12 comprehensive unit tests verifying circuit initialization, valid vote casting, double-vote rejection, unauthorized admin rejection, and state query integrity.
3. **Futuristic Cyber Emerald Glassmorphic Interface (`src/App.tsx`, `src/index.css`)**:
   - Multi-tab navigation across **Dashboard**, **Explore Proposals**, **Deploy Proposal**, **ZK Circuit Inspector**, **Voter Vault**, and **Audit & Reports**.
   - Live step-by-step ZK proof execution visualizer tracing witness extraction through on-chain submission.
   - Client-side Voter Vault generating 256-bit entropy keys with integrated double-vote nullifier verification.
4. **Multi-Wallet Integration (`src/votingApi.ts`)**:
   - Built-in provider bindings for Lace Wallet (Midnight Preprod) and Freighter Wallet, alongside an interactive sandbox simulator.
5. **Continuous Integration & Quality Assurance (`.github/workflows/ci.yml`)**:
   - GitHub Actions pipeline performing dependency installation, Compact smart contract compilation, Vitest test execution, and production Vite frontend building.
6. **Governance Audit & Data Export**:
   - One-click JSON and CSV governance state export functionality for audit trail compliance.
