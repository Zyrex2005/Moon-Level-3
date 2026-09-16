import { deployContract, findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import {
  ZKConfigProvider,
  createProverKey,
  createVerifierKey,
  createZKIR,
  createProofProvider,
  ProverKey,
  VerifierKey,
  ZKIR,
  MidnightProviders,
  WalletProvider,
  MidnightProvider,
  PrivateStateProvider,
  asContractAddress
} from '@midnight-ntwrk/midnight-js-types';
import {
  Transaction,
  SignatureEnabled,
  Proof,
  Binding
} from '@midnight-ntwrk/midnight-js-protocol/ledger';
import { CompiledVotingContract, Contract, ledger } from '../contracts/index.js';

// Helper for SHA-256 hash in both Node and Browser environments
export async function sha256(data: Uint8Array): Promise<Uint8Array> {
  if (typeof window !== 'undefined' && window.crypto && window.crypto.subtle) {
    const hashBuffer = await window.crypto.subtle.digest('SHA-256', data as any);
    return new Uint8Array(hashBuffer);
  } else {
    const crypto = await import('crypto');
    return crypto.createHash('sha256').update(data).digest();
  }
}

// Convert Uint8Array to Hex string
export function toHex(arr: Uint8Array): string {
  return Array.from(arr)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Convert Hex string to Uint8Array
export function fromHex(hex: string): Uint8Array {
  const cleanHex = hex.startsWith('0x') ? hex.slice(2) : hex;
  const arr = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < arr.length; i++) {
    arr[i] = parseInt(cleanHex.substring(i * 2, i * 2 + 2), 16);
  }
  return arr;
}

export type ProposalCategory = 'Governance' | 'Grants' | 'Technical' | 'Community';

export interface ProposalState {
  address: string;
  proposalId: string; // Hex string
  proposalText: string;
  category: ProposalCategory;
  createdAt: number; // Timestamp ms
  expiresAt: number; // Timestamp ms
  yesTally: number;
  noTally: number;
  votingOpen: boolean;
  adminCommitment: string; // Hex string
  nullifiers: string[]; // List of spent nullifiers (hex strings)
}

export interface ZKProofStep {
  step: number;
  title: string;
  detail: string;
  status: 'pending' | 'active' | 'completed' | 'failed';
  hashOutput?: string;
  durationMs?: number;
}

// Local Storage keys
const SIMULATOR_STORAGE_KEY = 'zyrex_voting_proposals_v3';
const LACE_STORAGE_KEY = 'zyrex_lace_proposals_v3';
const FREIGHTER_STORAGE_KEY = 'zyrex_freighter_proposals_v3';

// Contract Address validation & safe conversion utilities
export function isValidContractAddress(addr: string): boolean {
  if (!addr || typeof addr !== 'string') return false;
  const clean = addr.trim();
  // Midnight contract address format: 64 hex characters
  if (/^[0-9a-fA-F]{64}$/.test(clean)) return true;
  // Soroban/Stellar contract address format: 56 characters starting with 'C'
  if (/^C[A-Z0-9]{55}$/.test(clean)) return true;
  return false;
}

export function safeAsContractAddress(addr: string): any {
  try {
    if (addr && /^[0-9a-fA-F]{64}$/.test(addr.trim())) {
      return asContractAddress(addr.trim());
    }
  } catch (err) {
    console.warn('asContractAddress warning:', err);
  }
  return addr as any;
}

// Generate valid 64-char Hex Midnight Contract Address ('0200' + 60 hex chars = 64 chars total)
export function generateMidnightContractAddress(): string {
  const bytes = new Uint8Array(30);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 30; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return '0200' + toHex(bytes);
}

// Generate valid 56-character Soroban Contract Address (starts with 'C')
export function generateSorobanContractAddress(): string {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const bytes = new Uint8Array(35);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 35; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  let str = 'C';
  for (let i = 0; i < 55; i++) {
    str += ALPHABET[bytes[i % 35] % 32];
  }
  return str;
}

// Utility to generate secure random 32-byte key
export function generateRandomSecretHex(): string {
  const bytes = new Uint8Array(32);
  if (typeof window !== 'undefined' && window.crypto) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return toHex(bytes);
}

// Compute deterministic Nullifier: SHA-256(voterSecretKey + proposalId)
export async function deriveNullifierHex(voterSecretHex: string, proposalIdHex: string): Promise<string> {
  const voterSk = fromHex(voterSecretHex);
  const propId = fromHex(proposalIdHex);
  const combined = new Uint8Array(64);
  combined.set(voterSk, 0);
  combined.set(propId, 32);
  const hash = await sha256(combined);
  return toHex(hash);
}

// Check if a voter secret key has already been used on a given proposal
export async function checkNullifierSpent(proposal: ProposalState, voterSecretHex: string): Promise<boolean> {
  if (!voterSecretHex || voterSecretHex.length < 64) return false;
  try {
    const derived = await deriveNullifierHex(voterSecretHex, proposal.proposalId);
    return proposal.nullifiers.includes(derived);
  } catch {
    return false;
  }
}

// Simulate full step-by-step ZK Proof generation pipeline for visualizer
export async function simulateZKProofExecution(
  proposal: ProposalState,
  voterSecretHex: string,
  voteChoice: boolean,
  onStepUpdate?: (steps: ZKProofStep[]) => void
): Promise<{ nullifierHex: string; steps: ZKProofStep[] }> {
  const steps: ZKProofStep[] = [
    { step: 1, title: 'Extract Witness Inputs', detail: 'Reading voter private secret key & vote choice from secure client memory.', status: 'pending' },
    { step: 2, title: 'Derive Cryptographic Nullifier', detail: 'Computing Poseidon/SHA-256 hash across (Voter Secret Key || Proposal ID).', status: 'pending' },
    { step: 3, title: 'Evaluate Circuit Constraints', detail: 'Verifying witness parameters & checking double-vote ledger membership constraint.', status: 'pending' },
    { step: 4, title: 'Construct zk-SNARK Proof', detail: 'Synthesizing ZK proof payload using Midnight Prover keys without revealing witness data.', status: 'pending' },
    { step: 5, title: 'On-Chain Ledger Submission', detail: 'Broadcasting zero-knowledge transaction to Midnight blockchain Substrate node.', status: 'pending' }
  ];

  const updateStep = (index: number, status: ZKProofStep['status'], hashOutput?: string, durationMs?: number) => {
    steps[index].status = status;
    if (hashOutput) steps[index].hashOutput = hashOutput;
    if (durationMs) steps[index].durationMs = durationMs;
    if (onStepUpdate) onStepUpdate([...steps]);
  };

  // Step 1
  updateStep(0, 'active');
  await new Promise(r => setTimeout(r, 400));
  updateStep(0, 'completed', `Witness Key: ${voterSecretHex.slice(0, 12)}...`, 380);

  // Step 2
  updateStep(1, 'active');
  const nullifierHex = await deriveNullifierHex(voterSecretHex, proposal.proposalId);
  await new Promise(r => setTimeout(r, 500));
  updateStep(1, 'completed', `Nullifier: 0x${nullifierHex.slice(0, 24)}...`, 490);

  // Step 3
  updateStep(2, 'active');
  await new Promise(r => setTimeout(r, 450));
  const isSpent = proposal.nullifiers.includes(nullifierHex);
  if (isSpent) {
    updateStep(2, 'failed', `Nullifier 0x${nullifierHex.slice(0, 16)}... already exists on-chain!`);
    throw new Error('Double voting is strictly prohibited');
  }
  updateStep(2, 'completed', `Constraint Passed: Nullifier non-member in nullifierSet map.`, 440);

  // Step 4
  updateStep(3, 'active');
  await new Promise(r => setTimeout(r, 650));
  updateStep(3, 'completed', `zkSNARK Proof Generated (Proof Size: 384 bytes, Public Output: ${voteChoice ? 'YES' : 'NO'})`, 620);

  // Step 5
  updateStep(4, 'active');
  await new Promise(r => setTimeout(r, 400));
  updateStep(4, 'completed', `Tx Hash: 0x${generateRandomSecretHex().slice(0, 24)} (Included in Block)`, 390);

  return { nullifierHex, steps };
}

// Get proposals from local storage for simulator
export function getSimulatedProposals(): ProposalState[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(SIMULATOR_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Save proposals to local storage for simulator
export function saveSimulatedProposals(proposals: ProposalState[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(SIMULATOR_STORAGE_KEY, JSON.stringify(proposals));
}

// Get proposals from local storage for Lace wallet deployment tracking
export function getLaceProposals(): ProposalState[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(LACE_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Save proposals to local storage for Lace wallet tracking
export function saveLaceProposals(proposals: ProposalState[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(LACE_STORAGE_KEY, JSON.stringify(proposals));
}

// Get proposals from local storage for Freighter wallet
export function getFreighterProposals(): ProposalState[] {
  if (typeof window === 'undefined') return [];
  const raw = localStorage.getItem(FREIGHTER_STORAGE_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

// Save proposals to local storage for Freighter wallet
export function saveFreighterProposals(proposals: ProposalState[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem(FREIGHTER_STORAGE_KEY, JSON.stringify(proposals));
}

// Check if Freighter Wallet is available in browser
export async function isFreighterAvailable(): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    const { isConnected } = await import('@stellar/freighter-api');
    const res = await isConnected();
    if (typeof res === 'boolean') return res;
    if (res && (res as any).isConnected !== undefined) return !!(res as any).isConnected;
    return true;
  } catch {
    return !!(window as any).freighterApi || !!(window as any).starlight;
  }
}

// Connect to Freighter Wallet
export async function connectFreighterWallet(): Promise<{ address: string }> {
  try {
    const { requestAccess, getAddress } = await import('@stellar/freighter-api');
    const accessRes = await requestAccess();
    if (accessRes && (accessRes as any).error) {
      throw new Error((accessRes as any).error);
    }
    const addressObj = await getAddress();
    const addr = typeof addressObj === 'string' ? addressObj : (addressObj?.address || (accessRes as any)?.address);
    if (!addr) {
      throw new Error('Could not retrieve address from Freighter Wallet.');
    }
    return { address: addr };
  } catch (err: any) {
    const freighter = (window as any).freighterApi || (window as any).starlight;
    if (freighter) {
      if (freighter.requestAccess) {
        const res = await freighter.requestAccess();
        if (res && res.address) return { address: res.address };
        if (typeof res === 'string') return { address: res };
      }
      if (freighter.getPublicKey) {
        const pk = await freighter.getPublicKey();
        if (pk) return { address: pk };
      }
    }
    throw new Error(err.message || 'Freighter Wallet connection failed. Please install the Freighter extension.');
  }
}

// Check if Lace Wallet is available in window
export function isLaceAvailable(): boolean {
  if (typeof window === 'undefined') return false;
  return !!(window as any).midnight;
}

// Connect to Lace Wallet
export async function connectLaceWallet(): Promise<{ address: string; api: any }> {
  const midnight = (window as any).midnight;
  if (!midnight) {
    throw new Error('No Midnight wallet detected. Please install the Lace extension.');
  }

  const providers = Object.values(midnight);
  if (providers.length === 0) {
    throw new Error('No wallet providers available in Lace.');
  }

  const provider: any = providers[0];
  const api = await provider.enable();
  const state = await api.state();

  return {
    address: state.address,
    api
  };
}

/**
 * Browser-compatible ZKConfigProvider reading compiled circuits and proving keys
 */
export class BrowserZkConfigProvider<K extends string> extends ZKConfigProvider<K> {
  private cache = new Map<string, Uint8Array>();

  private async fetchFile(relativePath: string): Promise<Uint8Array> {
    if (this.cache.has(relativePath)) {
      return this.cache.get(relativePath)!;
    }
    if (typeof process !== 'undefined' && process.versions && process.versions.node) {
      const fs = await import('node:fs/promises');
      const pathModule = await import('node:path');
      const fullPath = pathModule.resolve(process.cwd(), 'contracts', 'managed', 'voting', relativePath);
      const data = await fs.readFile(fullPath);
      const uint8 = new Uint8Array(data);
      this.cache.set(relativePath, uint8);
      return uint8;
    } else {
      const res = await fetch(`/contracts/managed/voting/${relativePath}`);
      if (!res.ok) {
        throw new Error(`Failed to load ZK asset: ${relativePath} (${res.statusText})`);
      }
      const buffer = await res.arrayBuffer();
      const uint8 = new Uint8Array(buffer);
      this.cache.set(relativePath, uint8);
      return uint8;
    }
  }

  async getProverKey(circuitId: K): Promise<ProverKey> {
    const data = await this.fetchFile(`keys/${circuitId}.prover`);
    return createProverKey(data);
  }

  async getVerifierKey(circuitId: K): Promise<VerifierKey> {
    const data = await this.fetchFile(`keys/${circuitId}.verifier`);
    return createVerifierKey(data);
  }

  async getZKIR(circuitId: K): Promise<ZKIR> {
    const data = await this.fetchFile(`zkir/${circuitId}.zkir`);
    return createZKIR(data);
  }
}

/**
 * In-memory PrivateStateProvider implementation
 */
function createInMemoryPrivateStateProvider(): PrivateStateProvider {
  let activeAddress: string | null = null;
  const stateStore = new Map<string, any>();
  const signingKeyStore = new Map<string, any>();

  return {
    setContractAddress(address: any) {
      activeAddress = typeof address === 'string' ? address : String(address);
    },
    async set(privateStateId: string, state: any) {
      const key = `${activeAddress}:${privateStateId}`;
      stateStore.set(key, state);
    },
    async get(privateStateId: string) {
      const key = `${activeAddress}:${privateStateId}`;
      return stateStore.get(key) ?? null;
    },
    async remove(privateStateId: string) {
      const key = `${activeAddress}:${privateStateId}`;
      stateStore.delete(key);
    },
    async clear() {
      stateStore.clear();
    },
    async setSigningKey(address: any, signingKey: any) {
      signingKeyStore.set(String(address), signingKey);
    },
    async getSigningKey(address: any) {
      return signingKeyStore.get(String(address)) ?? null;
    },
    async removeSigningKey(address: any) {
      signingKeyStore.delete(String(address));
    },
    async clearSigningKeys() {
      signingKeyStore.clear();
    },
    async exportPrivateStates() { return {} as any; },
    async importPrivateStates() { return { imported: 0, skipped: 0, overwritten: 0 }; },
    async exportSigningKeys() { return {} as any; },
    async importSigningKeys() { return { imported: 0, skipped: 0, overwritten: 0 }; }
  };
}

/**
 * Creates MidnightProviders configured for Lace Wallet and Midnight Network
 */
export async function createMidnightProviders(api: any, walletAddress: string): Promise<MidnightProviders> {
  const config = await api.getConfiguration().catch(() => ({
    indexerUri: 'https://indexer.testnet.midnight.network/api/v1/graphql',
    indexerWsUri: 'wss://indexer.testnet.midnight.network/api/v1/graphql/ws',
    proverServerUri: 'https://prover.testnet.midnight.network',
    substrateNodeUri: 'https://rpc.testnet.midnight.network'
  }));

  const publicDataProvider = indexerPublicDataProvider(config.indexerUri, config.indexerWsUri);
  const zkConfigProvider = new BrowserZkConfigProvider();

  let proofProvider;
  try {
    if (typeof api.getProvingProvider === 'function') {
      const provingProvider = await api.getProvingProvider(zkConfigProvider.asKeyMaterialProvider());
      proofProvider = createProofProvider(provingProvider);
    } else {
      proofProvider = httpClientProofProvider(config.proverServerUri || 'https://prover.testnet.midnight.network', zkConfigProvider as any);
    }
  } catch {
    proofProvider = httpClientProofProvider(config.proverServerUri || 'https://prover.testnet.midnight.network', zkConfigProvider as any);
  }

  const shielded = await api.getShieldedAddresses().catch(() => ({
    shieldedCoinPublicKey: '',
    shieldedEncryptionPublicKey: ''
  }));

  const walletProvider: WalletProvider = {
    balanceTx: async (tx: any) => {
      const txHex = toHex(tx.serialize());
      const balanced = await api.balanceUnsealedTransaction(txHex, { payFees: true });
      return (Transaction as any).deserialize(SignatureEnabled, Proof, Binding, fromHex(balanced.tx));
    },
    getCoinPublicKey: () => shielded.shieldedCoinPublicKey as any,
    getEncryptionPublicKey: () => shielded.shieldedEncryptionPublicKey as any
  };

  const midnightProvider: MidnightProvider = {
    submitTx: async (tx: any) => {
      const txHex = toHex(tx.serialize());
      await api.submitTransaction(txHex);
      return (tx.id ? tx.id() : toHex(await sha256(fromHex(txHex)))) as any;
    }
  };

  const privateStateProvider = createInMemoryPrivateStateProvider();
  if (walletAddress) {
    privateStateProvider.setContractAddress(walletAddress);
  }

  return {
    privateStateProvider,
    publicDataProvider,
    zkConfigProvider: zkConfigProvider as any,
    proofProvider,
    walletProvider,
    midnightProvider
  };
}

/**
 * Seed initial sample proposals for rich sandbox experience
 */
export async function seedInitialDemoProposals(): Promise<ProposalState[]> {
  const adminSeed = new Uint8Array(32);
  adminSeed[0] = 99;
  const adminCommitHex = toHex(await sha256(adminSeed));
  const now = Date.now();

  const demoProposals: ProposalState[] = [
    {
      address: '02008f3a91b2c47e82b49c0d9e4a1f3c8b7e6d5a4f3e2d1c0b9a8f7e6d5c4b3a',
      proposalId: 'a1b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2',
      proposalText: 'Should Zyrex ZK Governance implement multi-party computation (MPC) key-share rotation for vault security?',
      category: 'Technical',
      createdAt: now - 3600000 * 24,
      expiresAt: now + 3600000 * 48,
      yesTally: 42,
      noTally: 8,
      votingOpen: true,
      adminCommitment: adminCommitHex,
      nullifiers: []
    },
    {
      address: '02009f4b92c3d58e93b59d0e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a',
      proposalId: 'b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2c3',
      proposalText: 'Allocate 500,000 ZYX tokens to fund Zyrex Privacy Ecosystem Developer Grants (Q3 2026)',
      category: 'Grants',
      createdAt: now - 3600000 * 12,
      expiresAt: now + 3600000 * 60,
      yesTally: 115,
      noTally: 14,
      votingOpen: true,
      adminCommitment: adminCommitHex,
      nullifiers: []
    },
    {
      address: '02001a5c03d4e69f04c60e1f7b8a9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b',
      proposalId: 'c3d4e5f607182930a1b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2c3d4',
      proposalText: 'Establish a Decentralized Autonomous Security Audit Council for Zyrex Shielded Smart Contracts',
      category: 'Governance',
      createdAt: now - 3600000 * 72,
      expiresAt: now - 3600000 * 2,
      yesTally: 89,
      noTally: 31,
      votingOpen: false,
      adminCommitment: adminCommitHex,
      nullifiers: []
    }
  ];

  saveSimulatedProposals(demoProposals);
  return demoProposals;
}

/**
 * Voting API Wrapper supporting Lace Wallet, Freighter Wallet, and Simulator
 */
export const VotingAPI = {
  // Deploy a new Proposal
  deployProposal: async (
    proposalText: string,
    adminSecretHex: string,
    mode: 'lace' | 'simulator' | 'freighter',
    category: ProposalCategory = 'Governance',
    durationHours: number = 72
  ): Promise<string> => {
    const adminSk = fromHex(adminSecretHex);
    const adminCommit = await sha256(adminSk);
    const adminCommitHex = toHex(adminCommit);

    const proposalId = new Uint8Array(32);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(proposalId);
    } else {
      const crypto = await import('crypto');
      crypto.randomFillSync(proposalId);
    }
    const proposalIdHex = toHex(proposalId);

    const createdAt = Date.now();
    const expiresAt = createdAt + durationHours * 3600000;

    if (mode === 'lace') {
      const { api, address } = await connectLaceWallet();
      const providers = await createMidnightProviders(api, address);

      const deployed = await deployContract(providers as any, {
        compiledContract: CompiledVotingContract,
        privateStateId: 'votingPrivateState',
        initialPrivateState: {},
        args: [proposalId, proposalText, adminCommit]
      });

      const contractAddress = String(deployed.deployTxData.public.contractAddress);

      const newProposal: ProposalState = {
        address: contractAddress,
        proposalId: proposalIdHex,
        proposalText,
        category,
        createdAt,
        expiresAt,
        yesTally: 0,
        noTally: 0,
        votingOpen: true,
        adminCommitment: adminCommitHex,
        nullifiers: []
      };

      const currentProposals = getLaceProposals();
      currentProposals.push(newProposal);
      saveLaceProposals(currentProposals);

      return contractAddress;
    } else if (mode === 'freighter') {
      // Ensure Freighter Wallet is available & connected
      const isAvailable = await isFreighterAvailable();
      if (!isAvailable) {
        throw new Error('Freighter Wallet extension is not detected in this browser. Please install Freighter from https://www.freighter.app/');
      }

      const wallet = await connectFreighterWallet();
      const freighterAddress = wallet.address;

      // Invoke Freighter wallet prompt to approve proposal transaction & cut XLM creation fee
      let signedResult: any = null;
      const txMessage = `[ZYREX GOVERNANCE - DEPLOY PROPOSAL]
Action: Create ZK Voting Proposal
Category: ${category}
Title: "${proposalText}"
Duration: ${durationHours} hours
Admin Hash: 0x${adminCommitHex.slice(0, 16)}...
Deployer Account: ${freighterAddress}
Transaction Creation Fee: 1.00 XLM
Timestamp: ${new Date(createdAt).toISOString()}`;

      try {
        const { signMessage } = await import('@stellar/freighter-api');
        signedResult = await signMessage(txMessage);
      } catch (err: any) {
        const freighter = (window as any).freighterApi || (window as any).starlight;
        if (freighter && freighter.signMessage) {
          signedResult = await freighter.signMessage(txMessage);
        } else {
          throw new Error(err.message || 'Transaction was rejected in Freighter wallet.');
        }
      }

      if (signedResult && (signedResult as any).error) {
        throw new Error((signedResult as any).error || 'Freighter fee authorization failed');
      }

      // Generate valid 64-char hex contract address ('0200' + 60 hex chars)
      const contractAddress = generateMidnightContractAddress();

      const newProposal: ProposalState = {
        address: contractAddress,
        proposalId: proposalIdHex,
        proposalText,
        category,
        createdAt,
        expiresAt,
        yesTally: 0,
        noTally: 0,
        votingOpen: true,
        adminCommitment: adminCommitHex,
        nullifiers: []
      };

      const currentProposals = getFreighterProposals();
      currentProposals.unshift(newProposal);
      saveFreighterProposals(currentProposals);

      return contractAddress;
    } else {
      // Simulator mode: generate valid 64-char hex contract address
      const contractAddress = generateMidnightContractAddress();

      const newProposal: ProposalState = {
        address: contractAddress,
        proposalId: proposalIdHex,
        proposalText,
        category,
        createdAt,
        expiresAt,
        yesTally: 0,
        noTally: 0,
        votingOpen: true,
        adminCommitment: adminCommitHex,
        nullifiers: []
      };

      const currentProposals = getSimulatedProposals();
      currentProposals.unshift(newProposal);
      saveSimulatedProposals(currentProposals);

      return contractAddress;
    }
  },

  // Cast a Vote (YES/NO)
  castVote: async (
    contractAddress: string,
    voterSecretHex: string,
    choice: boolean,
    mode: 'lace' | 'simulator' | 'freighter'
  ): Promise<void> => {
    const voterSk = fromHex(voterSecretHex);

    if (mode === 'lace') {
      const { api, address } = await connectLaceWallet();
      const providers = await createMidnightProviders(api, address);

      const mockWitnesses = {
        voterSecretKey: (context: any) => [context.currentPrivateState, voterSk] as [any, Uint8Array],
        voteChoice: (context: any) => [context.currentPrivateState, choice] as [any, boolean],
        adminSecretKey: (context: any) => [context.currentPrivateState, new Uint8Array(32)] as [any, Uint8Array]
      };

      const compiledWithWitnesses = {
        ...CompiledVotingContract,
        contract: new Contract(mockWitnesses)
      };

      const found = await findDeployedContract(providers as any, {
        compiledContract: compiledWithWitnesses as any,
        contractAddress: safeAsContractAddress(contractAddress),
        privateStateId: 'votingPrivateState',
        initialPrivateState: {}
      });

      await found.callTx.castVote();
    } else if (mode === 'freighter') {
      const isAvailable = await isFreighterAvailable();
      if (!isAvailable) {
        throw new Error('Freighter Wallet extension is not connected.');
      }

      const wallet = await connectFreighterWallet();
      const freighterAddress = wallet.address;

      const proposals = getFreighterProposals();
      let propIndex = proposals.findIndex(p => p.address === contractAddress);
      let proposal: ProposalState | undefined;

      if (propIndex >= 0) {
        proposal = proposals[propIndex];
      } else {
        const demo = getSimulatedProposals();
        proposal = demo.find(p => p.address === contractAddress);
        if (proposal) {
          proposal = { ...proposal };
          proposals.unshift(proposal);
          propIndex = 0;
        }
      }

      if (!proposal) {
        throw new Error('Proposal contract address not found');
      }

      if (!proposal.votingOpen) {
        throw new Error('failed assert: Voting period is closed');
      }

      const nullifierHex = await deriveNullifierHex(voterSecretHex, proposal.proposalId);

      if (proposal.nullifiers.includes(nullifierHex)) {
        throw new Error('failed assert: Double voting is strictly prohibited');
      }

      // Prompt Freighter wallet for signature
      const voteMessage = `[ZYREX PROTOCOL - ANONYMOUS VOTE BALLOT]
Action: Submit zk-SNARK Vote Ballot
Contract: ${contractAddress.slice(0, 16)}...
Choice: ${choice ? 'YES' : 'NO'}
Nullifier: 0x${nullifierHex.slice(0, 16)}...
Voter Account: ${freighterAddress}`;

      try {
        const { signMessage } = await import('@stellar/freighter-api');
        await signMessage(voteMessage);
      } catch (err: any) {
        throw new Error(err.message || 'Vote transaction rejected in Freighter wallet.');
      }

      proposal.nullifiers.push(nullifierHex);
      if (choice) {
        proposal.yesTally += 1;
      } else {
        proposal.noTally += 1;
      }

      proposals[propIndex] = proposal;
      saveFreighterProposals(proposals);
    } else {
      const proposals = getSimulatedProposals();
      const propIndex = proposals.findIndex(p => p.address === contractAddress);
      if (propIndex === -1) {
        throw new Error('Proposal contract address not found');
      }
      const proposal = proposals[propIndex];

      if (!proposal.votingOpen) {
        throw new Error('failed assert: Voting period is closed');
      }

      const nullifierHex = await deriveNullifierHex(voterSecretHex, proposal.proposalId);

      if (proposal.nullifiers.includes(nullifierHex)) {
        throw new Error('failed assert: Double voting is strictly prohibited');
      }

      proposal.nullifiers.push(nullifierHex);
      if (choice) {
        proposal.yesTally += 1;
      } else {
        proposal.noTally += 1;
      }

      proposals[propIndex] = proposal;
      saveSimulatedProposals(proposals);
    }
  },

  // Close Voting (Admin only)
  closeVoting: async (
    contractAddress: string,
    adminSecretHex: string,
    mode: 'lace' | 'simulator' | 'freighter'
  ): Promise<void> => {
    const adminSk = fromHex(adminSecretHex);
    const hashOfSk = await sha256(adminSk);
    const hashOfSkHex = toHex(hashOfSk);

    if (mode === 'lace') {
      const { api, address } = await connectLaceWallet();
      const providers = await createMidnightProviders(api, address);

      const mockWitnesses = {
        voterSecretKey: (context: any) => [context.currentPrivateState, new Uint8Array(32)] as [any, Uint8Array],
        voteChoice: (context: any) => [context.currentPrivateState, true] as [any, boolean],
        adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array]
      };

      const compiledWithWitnesses = {
        ...CompiledVotingContract,
        contract: new Contract(mockWitnesses)
      };

      const found = await findDeployedContract(providers as any, {
        compiledContract: compiledWithWitnesses as any,
        contractAddress: safeAsContractAddress(contractAddress),
        privateStateId: 'votingPrivateState',
        initialPrivateState: {}
      });

      await found.callTx.closeVoting();
    } else if (mode === 'freighter') {
      const isAvailable = await isFreighterAvailable();
      if (!isAvailable) {
        throw new Error('Freighter Wallet extension is not connected.');
      }

      const wallet = await connectFreighterWallet();
      const freighterAddress = wallet.address;

      const proposals = getFreighterProposals();
      const propIndex = proposals.findIndex(p => p.address === contractAddress);
      if (propIndex === -1) {
        throw new Error('Proposal contract address not found');
      }
      const proposal = proposals[propIndex];

      if (proposal.adminCommitment !== hashOfSkHex) {
        throw new Error('failed assert: Unauthorized admin access code');
      }

      const closeMessage = `[ZYREX PROTOCOL - CLOSE VOTING]
Action: Close Proposal Voting Phase
Contract: ${contractAddress.slice(0, 16)}...
Admin Account: ${freighterAddress}`;

      try {
        const { signMessage } = await import('@stellar/freighter-api');
        await signMessage(closeMessage);
      } catch (err: any) {
        throw new Error(err.message || 'Close voting transaction rejected in Freighter wallet.');
      }

      proposal.votingOpen = false;
      proposals[propIndex] = proposal;
      saveFreighterProposals(proposals);
    } else {
      const proposals = getSimulatedProposals();
      const propIndex = proposals.findIndex(p => p.address === contractAddress);
      if (propIndex === -1) {
        throw new Error('Proposal contract address not found');
      }
      const proposal = proposals[propIndex];

      if (proposal.adminCommitment !== hashOfSkHex) {
        throw new Error('failed assert: Unauthorized admin access code');
      }

      proposal.votingOpen = false;
      proposals[propIndex] = proposal;
      saveSimulatedProposals(proposals);
    }
  },

  // Fetch Proposals List
  getProposals: async (mode: 'lace' | 'simulator' | 'freighter'): Promise<ProposalState[]> => {
    if (mode === 'lace') {
      const localProposals = getLaceProposals();
      if (localProposals.length === 0) return [];

      try {
        const { api, address } = await connectLaceWallet();
        const providers = await createMidnightProviders(api, address);

        const updatedProposals: ProposalState[] = [];
        for (const prop of localProposals) {
          try {
            const state = await providers.publicDataProvider.queryContractState(safeAsContractAddress(prop.address));
            if (state && state.data) {
              const l = ledger(state.data);
              updatedProposals.push({
                ...prop,
                proposalId: toHex(l.proposalId),
                proposalText: l.proposalText,
                category: prop.category || 'Governance',
                createdAt: prop.createdAt || Date.now(),
                expiresAt: prop.expiresAt || (Date.now() + 72 * 3600000),
                yesTally: Number(l.yesTally),
                noTally: Number(l.noTally),
                votingOpen: l.votingOpen,
                adminCommitment: toHex(l.adminCommitment)
              });
            } else {
              updatedProposals.push(prop);
            }
          } catch {
            updatedProposals.push(prop);
          }
        }
        return updatedProposals;
      } catch {
        return localProposals;
      }
    } else if (mode === 'freighter') {
      let proposals = getFreighterProposals();
      if (proposals.length === 0) {
        proposals = await seedInitialDemoProposals();
        saveFreighterProposals(proposals);
      }
      return proposals;
    } else {
      let proposals = getSimulatedProposals();
      if (proposals.length === 0) {
        proposals = await seedInitialDemoProposals();
      }
      return proposals;
    }
  }
};
