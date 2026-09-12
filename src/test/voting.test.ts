import { describe, it, expect } from 'vitest';
import crypto from 'crypto';
import {
  createConstructorContext,
  createCircuitContext,
  dummyContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, ledger } from '../../contracts/managed/voting/contract/index.js';
import {
  deriveNullifierHex,
  generateRandomSecretHex,
  simulateZKProofExecution,
  ProposalState
} from '../votingApi.js';

// Setup common parameters
const dummyCoinPublicKey = new Uint8Array(32);
const proposalId = new Uint8Array(32);
proposalId[0] = 1;
const proposalText = "Should we adopt L3 solutions?";

const adminSk = new Uint8Array(32);
adminSk[0] = 100;
const adminCommit = crypto.createHash('sha256').update(adminSk).digest();

describe('Private Voting Smart Contract Tests', () => {
  it('Circuit Logic: cast a valid vote, tally increments by 1', () => {
    const mockWitnesses = {
      voterSecretKey: (context: any) => [context.currentPrivateState, new Uint8Array(32)] as [any, Uint8Array],
      voteChoice: (context: any) => [context.currentPrivateState, true] as [any, boolean], // Yes vote
      adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array]
    };

    const contract = new Contract(mockWitnesses);
    const constructorContext = createConstructorContext({}, dummyCoinPublicKey as any);

    const initResult = contract.initialState(constructorContext, proposalId, proposalText, adminCommit);
    const initialLedger = ledger(initResult.currentContractState.data);

    expect(initialLedger.proposalText).toBe(proposalText);
    expect(initialLedger.yesTally).toBe(0n);
    expect(initialLedger.noTally).toBe(0n);
    expect(initialLedger.votingOpen).toBe(true);

    const circuitContext = createCircuitContext(
      dummyContractAddress(),
      dummyCoinPublicKey as any,
      initResult.currentContractState,
      {}
    );

    const result = contract.circuits.castVote(circuitContext);
    const finalLedger = ledger(result.context.currentQueryContext.state);

    expect(finalLedger.yesTally).toBe(1n);
    expect(finalLedger.noTally).toBe(0n);
    expect(finalLedger.votingOpen).toBe(true);
  });

  it('Privacy Behavior: double-vote rejection using nullifier tracking', () => {
    const voterSk = new Uint8Array(32);
    voterSk[0] = 77; // Voter secret key

    const mockWitnesses = {
      voterSecretKey: (context: any) => [context.currentPrivateState, voterSk] as [any, Uint8Array],
      voteChoice: (context: any) => [context.currentPrivateState, false] as [any, boolean], // No vote
      adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array]
    };

    const contract = new Contract(mockWitnesses);
    const constructorContext = createConstructorContext({}, dummyCoinPublicKey as any);

    const initResult = contract.initialState(constructorContext, proposalId, proposalText, adminCommit);

    const circuitContext1 = createCircuitContext(
      dummyContractAddress(),
      dummyCoinPublicKey as any,
      initResult.currentContractState,
      {}
    );
    const result1 = contract.circuits.castVote(circuitContext1);
    const ledgerAfterVote1 = ledger(result1.context.currentQueryContext.state);

    expect(ledgerAfterVote1.noTally).toBe(1n);

    expect(() => {
      contract.circuits.castVote(result1.context);
    }).toThrowError(/Double voting/i);
  });

  it('State Transitions: voting-closed rejection after admin closure', () => {
    const mockWitnesses = {
      voterSecretKey: (context: any) => [context.currentPrivateState, new Uint8Array(32)] as [any, Uint8Array],
      voteChoice: (context: any) => [context.currentPrivateState, true] as [any, boolean],
      adminSecretKey: (context: any) => [context.currentPrivateState, adminSk] as [any, Uint8Array]
    };

    const contract = new Contract(mockWitnesses);
    const constructorContext = createConstructorContext({}, dummyCoinPublicKey as any);

    const initResult = contract.initialState(constructorContext, proposalId, proposalText, adminCommit);

    const closeContext = createCircuitContext(
      dummyContractAddress(),
      dummyCoinPublicKey as any,
      initResult.currentContractState,
      {}
    );
    const closeResult = contract.circuits.closeVoting(closeContext);
    const closedLedger = ledger(closeResult.context.currentQueryContext.state);

    expect(closedLedger.votingOpen).toBe(false);

    expect(() => {
      contract.circuits.castVote(closeResult.context);
    }).toThrowError(/Voting period is closed/i);
  });

  it('Frontend Helpers: deriveNullifierHex & ZK proof step simulation', async () => {
    const secret = generateRandomSecretHex();
    expect(secret.length).toBe(64);

    const nullifier = await deriveNullifierHex(secret, 'a1b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2');
    expect(nullifier.length).toBe(64);

    const mockProposal: ProposalState = {
      address: 'c_test123',
      proposalId: 'a1b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2c3d4e5f607182930a1b2',
      proposalText: 'Test Proposal',
      category: 'Governance',
      createdAt: Date.now(),
      expiresAt: Date.now() + 3600000,
      yesTally: 0,
      noTally: 0,
      votingOpen: true,
      adminCommitment: 'admin_test_commit',
      nullifiers: []
    };

    const sim = await simulateZKProofExecution(mockProposal, secret, true);
    expect(sim.steps.length).toBe(5);
    expect(sim.steps[4].status).toBe('completed');
  });
});
