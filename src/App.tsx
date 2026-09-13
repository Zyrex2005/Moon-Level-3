import React, { useState, useEffect } from 'react';
import {
  VotingAPI,
  ProposalState,
  ProposalCategory,
  ZKProofStep,
  isFreighterAvailable,
  connectFreighterWallet,
  isLaceAvailable,
  connectLaceWallet,
  generateRandomSecretHex,
  deriveNullifierHex,
  simulateZKProofExecution
} from './votingApi';

interface Toast {
  id: string;
  type: 'success' | 'error' | 'info';
  message: string;
}

export function App() {
  // Navigation active tab: 'dashboard' | 'proposals' | 'create' | 'zk-inspector' | 'vault' | 'analytics'
  const [activeTab, setActiveTab] = useState<'dashboard' | 'proposals' | 'create' | 'zk-inspector' | 'vault' | 'analytics'>('dashboard');

  // Network mode: 'simulator' | 'freighter' | 'lace'
  const [mode, setMode] = useState<'simulator' | 'freighter' | 'lace'>('simulator');
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletType, setWalletType] = useState<'freighter' | 'lace' | null>(null);

  // Proposals list
  const [proposals, setProposals] = useState<ProposalState[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

  // Search & Filter
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState<'All' | 'Active' | 'Closed'>('All');

  // Create Proposal state
  const [newText, setNewText] = useState('');
  const [newCategory, setNewCategory] = useState<ProposalCategory>('Governance');
  const [newDurationHours, setNewDurationHours] = useState<number>(72);
  const [deployAdminSecret, setDeployAdminSecret] = useState('');
  const [isDeploying, setIsDeploying] = useState(false);

  // Vote Modal State
  const [voteProposal, setVoteProposal] = useState<ProposalState | null>(null);
  const [voterSecretInput, setVoterSecretInput] = useState('');
  const [voteChoice, setVoteChoice] = useState<boolean>(true);
  const [isCastingVote, setIsCastingVote] = useState(false);

  // Close Voting Modal State
  const [closeProposal, setCloseProposal] = useState<ProposalState | null>(null);
  const [adminSecretInput, setAdminSecretInput] = useState('');
  const [isClosingVote, setIsClosingVote] = useState(false);

  // ZK Inspector Tab State
  const [inspectorProposalId, setInspectorProposalId] = useState<string>('');
  const [inspectorVoterSecret, setInspectorVoterSecret] = useState<string>('');
  const [inspectorChoice, setInspectorChoice] = useState<boolean>(true);
  const [zkSteps, setZkSteps] = useState<ZKProofStep[]>([]);
  const [isSimulatingZk, setIsSimulatingZk] = useState(false);
  const [zkResultNullifier, setZkResultNullifier] = useState<string | null>(null);

  // Voter Vault State
  const [generatedSecretKey, setGeneratedSecretKey] = useState<string>('');
  const [vaultCheckProposalAddress, setVaultCheckProposalAddress] = useState<string>('');
  const [vaultCheckSecretKey, setVaultCheckSecretKey] = useState<string>('');
  const [vaultCheckResult, setVaultCheckResult] = useState<{ checked: boolean; isSpent: boolean; nullifierHex: string } | null>(null);

  // Toasts
  const [toasts, setToasts] = useState<Toast[]>([]);

  const showToast = (type: 'success' | 'error' | 'info', message: string) => {
    const id = Date.now().toString() + Math.random().toString().slice(2, 5);
    setToasts((prev) => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 4500);
  };

  // Load proposals when mode changes
  const fetchProposals = async () => {
    setLoading(true);
    try {
      const list = await VotingAPI.getProposals(mode);
      setProposals(list);
      if (list.length > 0 && !inspectorProposalId) {
        setInspectorProposalId(list[0].address);
      }
    } catch (err: any) {
      showToast('error', `Failed to load proposals: ${err.message}`);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchProposals();
  }, [mode]);

  // Connect Freighter Wallet
  const handleConnectFreighterWallet = async () => {
    try {
      const available = await isFreighterAvailable();
      if (!available) {
        showToast('error', 'Freighter Wallet extension not detected on this browser. Please install Freighter from https://www.freighter.app/');
        return;
      }
      showToast('info', 'Connecting to Freighter Wallet...');
      const connection = await connectFreighterWallet();
      setWalletAddress(connection.address);
      setWalletType('freighter');
      setMode('freighter');
      showToast('success', `Connected to Freighter Wallet: ${connection.address.slice(0, 8)}...${connection.address.slice(-4)}`);
    } catch (err: any) {
      showToast('error', `Freighter connection failed: ${err.message}`);
    }
  };

  // Connect Lace Wallet
  const handleConnectLaceWallet = async () => {
    try {
      if (!isLaceAvailable()) {
        showToast('error', 'Lace Wallet extension not detected on this browser.');
        return;
      }
      showToast('info', 'Connecting to Lace Wallet...');
      const connection = await connectLaceWallet();
      setWalletAddress(connection.address);
      setWalletType('lace');
      setMode('lace');
      showToast('success', `Connected to Lace Wallet: ${connection.address.slice(0, 10)}...`);
    } catch (err: any) {
      showToast('error', `Wallet connection failed: ${err.message}`);
    }
  };

  // Generate Admin Secret for deploy
  const handleGenerateDeployAdminSecret = () => {
    const sec = generateRandomSecretHex();
    setDeployAdminSecret(sec);
    showToast('info', 'Generated random Admin Secret key.');
  };

  // Generate Voter Secret for vault or Inspector
  const handleGenerateVoterSecret = () => {
    const sec = generateRandomSecretHex();
    setGeneratedSecretKey(sec);
    showToast('success', 'New 256-bit Voter Secret Key generated.');
  };

  // Create Proposal Submit
  const handleDeployProposal = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newText.trim()) {
      showToast('error', 'Please enter proposal text');
      return;
    }
    if (!deployAdminSecret || deployAdminSecret.length < 64) {
      showToast('error', 'Please enter or generate a valid 64-character hex Admin Secret key.');
      return;
    }

    setIsDeploying(true);
    try {
      showToast('info', 'Deploying Private Voting contract to Midnight...');
      const address = await VotingAPI.deployProposal(newText, deployAdminSecret, mode, newCategory, newDurationHours);
      showToast('success', `Proposal deployed successfully! Contract: ${address.slice(0, 16)}...`);
      setNewText('');
      setDeployAdminSecret('');
      await fetchProposals();
      setActiveTab('proposals');
    } catch (err: any) {
      showToast('error', `Deployment failed: ${err.message}`);
    } finally {
      setIsDeploying(false);
    }
  };

  // Open Vote Modal
  const handleOpenVoteModal = (prop: ProposalState) => {
    if (!prop.votingOpen) {
      showToast('error', 'This proposal voting period is closed.');
      return;
    }
    setVoteProposal(prop);
    setVoterSecretInput(generateRandomSecretHex());
    setVoteChoice(true);
  };

  // Submit Vote
  const handleCastVote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!voteProposal) return;
    if (!voterSecretInput || voterSecretInput.length < 64) {
      showToast('error', 'Please enter a valid 64-character hex Voter Secret Key.');
      return;
    }

    setIsCastingVote(true);
    try {
      showToast('info', 'Generating Zero-Knowledge Proof & submitting ballot...');
      await VotingAPI.castVote(voteProposal.address, voterSecretInput, voteChoice, mode);
      showToast('success', `Vote cast anonymously with ZK proof!`);
      setVoteProposal(null);
      setVoterSecretInput('');
      await fetchProposals();
    } catch (err: any) {
      showToast('error', `Voting failed: ${err.message}`);
    } finally {
      setIsCastingVote(false);
    }
  };

  // Close Proposal Submit
  const handleCloseVotingSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!closeProposal) return;
    if (!adminSecretInput) {
      showToast('error', 'Please enter the Admin Secret key.');
      return;
    }

    setIsClosingVote(true);
    try {
      showToast('info', 'Verifying Admin Secret & closing voting...');
      await VotingAPI.closeVoting(closeProposal.address, adminSecretInput, mode);
      showToast('success', `Voting closed for proposal.`);
      setCloseProposal(null);
      setAdminSecretInput('');
      await fetchProposals();
    } catch (err: any) {
      showToast('error', `Close voting failed: ${err.message}`);
    } finally {
      setIsClosingVote(false);
    }
  };

  // Run ZK Inspector Simulation
  const handleRunZkInspection = async () => {
    const targetProp = proposals.find(p => p.address === inspectorProposalId);
    if (!targetProp) {
      showToast('error', 'Please select a proposal for ZK inspection.');
      return;
    }
    const secret = inspectorVoterSecret || generateRandomSecretHex();
    if (!inspectorVoterSecret) setInspectorVoterSecret(secret);

    setIsSimulatingZk(true);
    setZkResultNullifier(null);
    try {
      const res = await simulateZKProofExecution(targetProp, secret, inspectorChoice, (updatedSteps) => {
        setZkSteps(updatedSteps);
      });
      setZkResultNullifier(res.nullifierHex);
      showToast('success', 'Zero-Knowledge Circuit execution simulation complete!');
    } catch (err: any) {
      showToast('error', `Circuit execution error: ${err.message}`);
    } finally {
      setIsSimulatingZk(false);
    }
  };

  // Vault Check Nullifier Status
  const handleCheckNullifierVault = async () => {
    const targetProp = proposals.find(p => p.address === vaultCheckProposalAddress);
    if (!targetProp) {
      showToast('error', 'Select a proposal to check nullifier status.');
      return;
    }
    if (!vaultCheckSecretKey || vaultCheckSecretKey.length < 64) {
      showToast('error', 'Enter a 64-character voter secret key.');
      return;
    }
    try {
      const nullifierHex = await deriveNullifierHex(vaultCheckSecretKey, targetProp.proposalId);
      const isSpent = targetProp.nullifiers.includes(nullifierHex);
      setVaultCheckResult({ checked: true, isSpent, nullifierHex });
    } catch (err: any) {
      showToast('error', `Check failed: ${err.message}`);
    }
  };

  // Export JSON/CSV
  const handleExportJSON = () => {
    const jsonStr = JSON.stringify(proposals, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zyrex_governance_audit_${Date.now()}.json`;
    a.click();
    showToast('success', 'Exported proposals data as JSON');
  };

  const handleExportCSV = () => {
    let csv = 'Address,ProposalID,Category,Text,YesVotes,NoVotes,Status,NullifierCount\n';
    proposals.forEach(p => {
      csv += `"${p.address}","${p.proposalId}","${p.category}","${p.proposalText.replace(/"/g, '""')}",${p.yesTally},${p.noTally},"${p.votingOpen ? 'ACTIVE' : 'CLOSED'}",${p.nullifiers.length}\n`;
    });
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `zyrex_governance_report_${Date.now()}.csv`;
    a.click();
    showToast('success', 'Exported proposals report as CSV');
  };

  // Filtered Proposals
  const filteredProposals = proposals.filter(p => {
    const matchesSearch = p.proposalText.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
                          p.category.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = selectedCategory === 'All' || p.category === selectedCategory;
    const matchesStatus = selectedStatusFilter === 'All' ||
                          (selectedStatusFilter === 'Active' && p.votingOpen) ||
                          (selectedStatusFilter === 'Closed' && !p.votingOpen);
    return matchesSearch && matchesCategory && matchesStatus;
  });

  // Overview Metrics
  const totalProposalsCount = proposals.length;
  const activeProposalsCount = proposals.filter(p => p.votingOpen).length;
  const totalVotesCast = proposals.reduce((acc, p) => acc + p.yesTally + p.noTally, 0);

  return (
    <div className="app-shell">
      {/* Top Navbar */}
      <header className="top-navbar">
        <div className="brand-badge">
          <div className="brand-logo-glow">⚡</div>
          <div>
            <div className="brand-title">Zyrex ZK Governance</div>
            <div className="brand-subtitle">Privacy-Preserving DAO Suite</div>
          </div>
        </div>

        {/* Center Tabs Navigation */}
        <nav className="nav-tabs-bar">
          <button className={`nav-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            📊 Dashboard
          </button>
          <button className={`nav-tab-btn ${activeTab === 'proposals' ? 'active' : ''}`} onClick={() => setActiveTab('proposals')}>
            🗳️ Proposals ({proposals.length})
          </button>
          <button className={`nav-tab-btn ${activeTab === 'create' ? 'active' : ''}`} onClick={() => setActiveTab('create')}>
            ➕ Deploy Proposal
          </button>
          <button className={`nav-tab-btn ${activeTab === 'zk-inspector' ? 'active' : ''}`} onClick={() => setActiveTab('zk-inspector')}>
            ⚡ ZK Circuit Inspector
          </button>
          <button className={`nav-tab-btn ${activeTab === 'vault' ? 'active' : ''}`} onClick={() => setActiveTab('vault')}>
            🔐 Voter Vault
          </button>
          <button className={`nav-tab-btn ${activeTab === 'analytics' ? 'active' : ''}`} onClick={() => setActiveTab('analytics')}>
            📈 Audit & Reports
          </button>
        </nav>

        {/* Network & Wallet Controls */}
        <div className="mode-toggle-group">
          <div className="network-pill">
            <span className="network-dot"></span>
            {mode === 'freighter' ? 'Freighter Connected' : mode === 'lace' ? 'Lace Connected' : 'Zyrex ZK Sandbox'}
          </div>

          {walletAddress ? (
            <button className="btn-secondary" style={{ fontFamily: 'var(--font-code)', fontSize: '0.8rem' }} onClick={() => { setWalletAddress(null); setMode('simulator'); showToast('info', 'Wallet disconnected'); }}>
              🚀 {walletType === 'freighter' ? 'Freighter' : 'Lace'}: {walletAddress.slice(0, 6)}...{walletAddress.slice(-4)} (Disconnect)
            </button>
          ) : (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button className="btn-primary" onClick={handleConnectFreighterWallet}>
                🚀 Connect Freighter Wallet
              </button>
              <button className="btn-secondary" style={{ fontSize: '0.8rem' }} onClick={handleConnectLaceWallet}>
                Lace Wallet
              </button>
            </div>
          )}

          {mode !== 'simulator' && (
            <button className="btn-secondary" style={{ fontSize: '0.8rem' }} onClick={() => { setMode('simulator'); setWalletAddress(null); }}>
              Switch to Sandbox
            </button>
          )}
        </div>
      </header>

      {/* Main Body */}
      <main className="main-wrapper">
        {/* TAB 1: DASHBOARD */}
        {activeTab === 'dashboard' && (
          <div>
            <div style={{ marginBottom: '2rem' }}>
              <h1 style={{ fontFamily: 'var(--font-heading)', fontSize: '2.2rem', marginBottom: '0.5rem' }}>
                Zyrex ZK Governance Dashboard
              </h1>
              <p style={{ color: 'var(--text-muted)' }}>
                Verifiable, zero-knowledge anonymous ballots with cryptographic privacy guarantees.
              </p>
            </div>

            {/* Stats Cards Grid */}
            <div className="stats-grid">
              <div className="glass-card stat-card">
                <div className="stat-icon cyan">📜</div>
                <div>
                  <div className="stat-value">{totalProposalsCount}</div>
                  <div className="stat-label">Total Proposals</div>
                </div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon emerald">🟢</div>
                <div>
                  <div className="stat-value">{activeProposalsCount}</div>
                  <div className="stat-label">Active Voting Rounds</div>
                </div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon violet">🗳️</div>
                <div>
                  <div className="stat-value">{totalVotesCast}</div>
                  <div className="stat-label">Anonymous Ballots Cast</div>
                </div>
              </div>
              <div className="glass-card stat-card">
                <div className="stat-icon amber">⚡</div>
                <div>
                  <div className="stat-value">100%</div>
                  <div className="stat-label">ZK Proof Privacy Rate</div>
                </div>
              </div>
            </div>

            {/* Quick Actions & Privacy Overview */}
            <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: '1.5rem', marginBottom: '2rem' }}>
              <div className="glass-card">
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.25rem', marginBottom: '1rem' }}>
                  🔥 Active Proposals Highlights
                </h3>
                {proposals.filter(p => p.votingOpen).length === 0 ? (
                  <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    No active proposals right now. <button className="btn-primary" onClick={() => setActiveTab('create')}>Create one!</button>
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                    {proposals.filter(p => p.votingOpen).slice(0, 3).map(p => {
                      const total = p.yesTally + p.noTally;
                      const yesPct = total > 0 ? Math.round((p.yesTally / total) * 100) : 50;
                      return (
                        <div key={p.address} style={{ background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: 'var(--radius-md)', border: '1px solid var(--border-subtle)' }}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                            <span className="category-tag">{p.category}</span>
                            <span className="status-badge open">Active</span>
                          </div>
                          <h4 style={{ fontFamily: 'var(--font-heading)', fontSize: '1rem', margin: '0.4rem 0' }}>{p.proposalText}</h4>
                          <div className="vote-bar-track" style={{ marginTop: '0.6rem' }}>
                            <div className="vote-bar-fill" style={{ width: `${yesPct}%` }}></div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.4rem' }}>
                            <span>YES: {p.yesTally} ({yesPct}%)</span>
                            <span>NO: {p.noTally} ({100 - yesPct}%)</span>
                          </div>
                          <div style={{ marginTop: '0.75rem', textAlign: 'right' }}>
                            <button className="btn-primary" style={{ fontSize: '0.82rem', padding: '0.4rem 0.85rem' }} onClick={() => handleOpenVoteModal(p)}>
                              Cast Anonymous Vote
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              {/* Privacy Architecture Box */}
              <div className="glass-card" style={{ background: 'linear-gradient(135deg, rgba(0, 242, 254, 0.05), rgba(157, 78, 221, 0.05))' }}>
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.2rem', marginBottom: '1rem', color: 'var(--cyan-accent)' }}>
                  🔒 ZK-Privacy Guarantees
                </h3>
                <ul style={{ listStyle: 'none', display: 'flex', flexDirection: 'column', gap: '0.85rem', fontSize: '0.88rem', color: 'var(--text-muted)' }}>
                  <li style={{ display: 'flex', gap: '0.6rem' }}>
                    <span>✨</span>
                    <span><strong>Nullifier Derivation:</strong> Prevents double-voting using client-side persistent hashes.</span>
                  </li>
                  <li style={{ display: 'flex', gap: '0.6rem' }}>
                    <span>🛡️</span>
                    <span><strong>Zero Ballot Leakage:</strong> Votes are publicly incremented without linking voter address to choice.</span>
                  </li>
                  <li style={{ display: 'flex', gap: '0.6rem' }}>
                    <span>⚡</span>
                    <span><strong>Midnight zkSNARK Prover:</strong> Computes witness constraints inside local browser memory.</span>
                  </li>
                </ul>
                <div style={{ marginTop: '1.5rem' }}>
                  <button className="btn-secondary" style={{ width: '100%' }} onClick={() => setActiveTab('zk-inspector')}>
                    Test ZK Circuit Inspector →
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: EXPLORE PROPOSALS */}
        {activeTab === 'proposals' && (
          <div>
            <div className="toolbar">
              {/* Category Pills */}
              <div className="category-pills">
                {['All', 'Governance', 'Grants', 'Technical', 'Community'].map(cat => (
                  <button
                    key={cat}
                    className={`category-pill-btn ${selectedCategory === cat ? 'active' : ''}`}
                    onClick={() => setSelectedCategory(cat)}
                  >
                    {cat}
                  </button>
                ))}
              </div>

              {/* Search & Status Filter */}
              <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
                <div className="search-input-box">
                  <span>🔍</span>
                  <input
                    type="text"
                    placeholder="Search proposals by title, address..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                  />
                </div>

                <select
                  className="form-control"
                  style={{ width: '130px', padding: '0.55rem 0.85rem', fontSize: '0.85rem' }}
                  value={selectedStatusFilter}
                  onChange={(e: any) => setSelectedStatusFilter(e.target.value)}
                >
                  <option value="All">All Status</option>
                  <option value="Active">Active Only</option>
                  <option value="Closed">Closed Only</option>
                </select>
              </div>
            </div>

            {/* Grid */}
            {loading ? (
              <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--text-muted)' }}>
                Loading Midnight smart contracts...
              </div>
            ) : filteredProposals.length === 0 ? (
              <div className="glass-card" style={{ textAlign: 'center', padding: '3rem' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '1.1rem' }}>No proposals matched your criteria.</p>
                <button className="btn-primary" style={{ marginTop: '1rem' }} onClick={() => { setSearchQuery(''); setSelectedCategory('All'); setSelectedStatusFilter('All'); }}>
                  Reset Filters
                </button>
              </div>
            ) : (
              <div className="proposals-grid">
                {filteredProposals.map(p => {
                  const total = p.yesTally + p.noTally;
                  const yesPct = total > 0 ? Math.round((p.yesTally / total) * 100) : 50;
                  return (
                    <div key={p.address} className="glass-card proposal-card">
                      <div>
                        <div className="proposal-header">
                          <span className="category-tag">{p.category}</span>
                          <span className={`status-badge ${p.votingOpen ? 'open' : 'closed'}`}>
                            {p.votingOpen ? '🟢 Active' : '🔴 Voting Closed'}
                          </span>
                        </div>

                        <h3 className="proposal-title">{p.proposalText}</h3>

                        <div className="vote-distribution-box">
                          <div className="vote-counts-row">
                            <span className="yes-count">YES: {p.yesTally} ({yesPct}%)</span>
                            <span className="no-count">NO: {p.noTally} ({total > 0 ? 100 - yesPct : 50}%)</span>
                          </div>
                          <div className="vote-bar-track">
                            <div className="vote-bar-fill" style={{ width: `${yesPct}%` }}></div>
                          </div>
                          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.4rem' }}>
                            <span>Total Votes: {total}</span>
                            <span>Spent Nullifiers: {p.nullifiers.length}</span>
                          </div>
                        </div>
                      </div>

                      <div className="proposal-footer">
                        <span className="contract-code" title={p.address}>
                          {p.address.slice(0, 14)}...
                        </span>

                        <div style={{ display: 'flex', gap: '0.5rem' }}>
                          {p.votingOpen ? (
                            <>
                              <button className="btn-primary" style={{ fontSize: '0.82rem', padding: '0.5rem 0.85rem' }} onClick={() => handleOpenVoteModal(p)}>
                                🗳️ Cast Vote
                              </button>
                              <button className="btn-outline-danger" style={{ fontSize: '0.82rem', padding: '0.5rem 0.85rem' }} onClick={() => setCloseProposal(p)}>
                                🔒 Close
                              </button>
                            </>
                          ) : (
                            <button className="btn-secondary" style={{ fontSize: '0.82rem', padding: '0.5rem 0.85rem' }} onClick={() => { setInspectorProposalId(p.address); setActiveTab('zk-inspector'); }}>
                              ⚡ Inspect Circuit
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {/* TAB 3: CREATE PROPOSAL */}
        {activeTab === 'create' && (
          <div style={{ maxWidth: '720px', margin: '0 auto' }}>
            <div className="glass-card">
              <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.6rem', marginBottom: '0.5rem' }}>
                Deploy New Private Proposal
              </h2>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.5rem' }}>
                Compiles & deploys a fresh ZK smart contract on Midnight to hold anonymous voting tallies.
              </p>

              <form onSubmit={handleDeployProposal}>
                <div className="form-group">
                  <label className="form-label">Proposal Category</label>
                  <select
                    className="form-control"
                    value={newCategory}
                    onChange={(e: any) => setNewCategory(e.target.value)}
                  >
                    <option value="Governance">Governance</option>
                    <option value="Grants">Grants</option>
                    <option value="Technical">Technical</option>
                    <option value="Community">Community</option>
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Proposal Statement / Question</label>
                  <textarea
                    className="form-control"
                    placeholder="e.g. Should Zyrex ZK Governance implement multi-party computation (MPC) key-share rotation for vault security?"
                    value={newText}
                    onChange={(e) => setNewText(e.target.value)}
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Voting Duration (Hours)</label>
                  <input
                    type="number"
                    className="form-control"
                    value={newDurationHours}
                    onChange={(e) => setNewDurationHours(Number(e.target.value))}
                    min={1}
                    max={720}
                  />
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <label className="form-label" style={{ margin: 0 }}>Admin Secret Key (64 Hex chars)</label>
                    <button type="button" className="btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.6rem' }} onClick={handleGenerateDeployAdminSecret}>
                      ⚡ Auto Generate Key
                    </button>
                  </div>
                  <input
                    type="text"
                    className="form-control"
                    style={{ fontFamily: 'var(--font-code)', fontSize: '0.85rem' }}
                    placeholder="e.g. 63a48e... (Keep secret to close voting later)"
                    value={deployAdminSecret}
                    onChange={(e) => setDeployAdminSecret(e.target.value)}
                  />
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-dim)', marginTop: '0.3rem' }}>
                    The SHA-256 hash of this key is stored on-chain as `adminCommitment` to restrict authorization for closing voting.
                  </div>
                </div>

                <div style={{ marginTop: '2rem', display: 'flex', gap: '1rem', justifyContent: 'flex-end' }}>
                  <button type="button" className="btn-secondary" onClick={() => setActiveTab('proposals')}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={isDeploying}>
                    {isDeploying ? 'Deploying to Midnight...' : '🚀 Deploy Smart Contract'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {/* TAB 4: ZK PROOF INSPECTOR */}
        {activeTab === 'zk-inspector' && (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.8rem', marginBottom: '0.4rem' }}>
                Zero-Knowledge Circuit Simulator & Inspector
              </h2>
              <p style={{ color: 'var(--text-muted)' }}>
                Interactively inspect witness generation, Poseidon/SHA-256 nullifier derivation, and zkSNARK proof execution stages.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.5fr', gap: '1.5rem' }}>
              {/* Controls */}
              <div className="glass-card">
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.2rem', marginBottom: '1rem' }}>
                  Circuit Inputs
                </h3>

                <div className="form-group">
                  <label className="form-label">Select Proposal</label>
                  <select
                    className="form-control"
                    value={inspectorProposalId}
                    onChange={(e) => setInspectorProposalId(e.target.value)}
                  >
                    {proposals.map(p => (
                      <option key={p.address} value={p.address}>
                        [{p.category}] {p.proposalText.slice(0, 45)}...
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                    <label className="form-label" style={{ margin: 0 }}>Voter Private Secret Witness Key</label>
                    <button type="button" className="btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} onClick={() => setInspectorVoterSecret(generateRandomSecretHex())}>
                      Generate Key
                    </button>
                  </div>
                  <input
                    type="text"
                    className="form-control"
                    style={{ fontFamily: 'var(--font-code)', fontSize: '0.82rem' }}
                    value={inspectorVoterSecret}
                    onChange={(e) => setInspectorVoterSecret(e.target.value)}
                    placeholder="Enter 64-character secret key"
                  />
                </div>

                <div className="form-group">
                  <label className="form-label">Vote Witness Choice</label>
                  <div style={{ display: 'flex', gap: '1rem' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input type="radio" name="choice" checked={inspectorChoice === true} onChange={() => setInspectorChoice(true)} />
                      🟢 YES (In favor)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', cursor: 'pointer', fontSize: '0.9rem' }}>
                      <input type="radio" name="choice" checked={inspectorChoice === false} onChange={() => setInspectorChoice(false)} />
                      🔴 NO (Against)
                    </label>
                  </div>
                </div>

                <button className="btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={handleRunZkInspection} disabled={isSimulatingZk}>
                  {isSimulatingZk ? 'Executing Circuit Prover...' : '⚡ Run ZK Circuit Simulation'}
                </button>
              </div>

              {/* Step Execution Logs */}
              <div className="glass-card">
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.2rem', marginBottom: '1rem' }}>
                  Execution Pipeline Step Logs
                </h3>

                {zkSteps.length === 0 ? (
                  <div style={{ padding: '3rem', textAlign: 'center', color: 'var(--text-muted)' }}>
                    Click "Run ZK Circuit Simulation" to trace step-by-step witness constraint proving.
                  </div>
                ) : (
                  <div className="zk-inspector-box">
                    {zkSteps.map(st => (
                      <div key={st.step} className={`zk-step-row ${st.status}`}>
                        <div className="zk-step-num">{st.step}</div>
                        <div className="zk-step-content">
                          <div className="zk-step-title">{st.title}</div>
                          <div className="zk-step-detail">{st.detail}</div>
                          {st.hashOutput && <div className="zk-output-code">{st.hashOutput}</div>}
                        </div>
                      </div>
                    ))}

                    {zkResultNullifier && (
                      <div style={{ marginTop: '1rem', background: 'rgba(16, 185, 129, 0.1)', border: '1px solid var(--emerald-accent)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
                        <div style={{ fontWeight: 600, color: 'var(--emerald-accent)' }}>✅ Proof Generated & Verified On-Chain!</div>
                        <div style={{ fontFamily: 'var(--font-code)', fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '0.3rem', wordBreak: 'break-all' }}>
                          Spent Nullifier Hash: 0x{zkResultNullifier}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 5: VOTER VAULT */}
        {activeTab === 'vault' && (
          <div>
            <div style={{ marginBottom: '1.5rem' }}>
              <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.8rem', marginBottom: '0.4rem' }}>
                Voter Key Vault & Nullifier Status Tool
              </h2>
              <p style={{ color: 'var(--text-muted)' }}>
                Client-side secret key generator and anonymous membership validator.
              </p>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1.5rem' }}>
              {/* Secret Key Generator */}
              <div className="glass-card key-vault-card">
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.2rem', marginBottom: '1rem' }}>
                  🔑 Secret Voter Keypair Generator
                </h3>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1.2rem' }}>
                  Generates cryptographic 256-bit entropy used to sign private witness inputs without broadcasting your address.
                </p>

                <button className="btn-primary" style={{ marginBottom: '1rem' }} onClick={handleGenerateVoterSecret}>
                  ⚡ Generate Random Voter Secret Key
                </button>

                {generatedSecretKey && (
                  <div>
                    <label className="form-label">Generated 256-Bit Hex Key</label>
                    <div className="code-field-box" style={{ marginBottom: '0.75rem' }}>
                      <input type="text" readOnly value={generatedSecretKey} />
                      <button
                        className="btn-secondary"
                        style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }}
                        onClick={() => { navigator.clipboard.writeText(generatedSecretKey); showToast('success', 'Copied to clipboard!'); }}
                      >
                        Copy
                      </button>
                    </div>
                    <div style={{ fontSize: '0.78rem', color: 'var(--amber-accent)' }}>
                      ⚠️ Store this secret safely. If lost, you cannot cast your ballot for authorized proposals.
                    </div>
                  </div>
                )}
              </div>

              {/* Nullifier Status Validator */}
              <div className="glass-card">
                <h3 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.2rem', marginBottom: '1rem' }}>
                  🔍 Double-Vote Nullifier Checker
                </h3>
                <p style={{ fontSize: '0.88rem', color: 'var(--text-muted)', marginBottom: '1.2rem' }}>
                  Verify whether a voter secret key has already been spent on a specific proposal without revealing which choice was cast.
                </p>

                <div className="form-group">
                  <label className="form-label">Select Proposal</label>
                  <select
                    className="form-control"
                    value={vaultCheckProposalAddress}
                    onChange={(e) => setVaultCheckProposalAddress(e.target.value)}
                  >
                    <option value="">Select proposal...</option>
                    {proposals.map(p => (
                      <option key={p.address} value={p.address}>
                        {p.proposalText.slice(0, 45)}...
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Voter Secret Key</label>
                  <input
                    type="text"
                    className="form-control"
                    style={{ fontFamily: 'var(--font-code)', fontSize: '0.85rem' }}
                    placeholder="Enter 64-character voter secret key"
                    value={vaultCheckSecretKey}
                    onChange={(e) => setVaultCheckSecretKey(e.target.value)}
                  />
                </div>

                <button className="btn-secondary" style={{ width: '100%' }} onClick={handleCheckNullifierVault}>
                  Check Nullifier Ledger Status
                </button>

                {vaultCheckResult && vaultCheckResult.checked && (
                  <div style={{ marginTop: '1.2rem', padding: '1rem', borderRadius: 'var(--radius-md)', background: vaultCheckResult.isSpent ? 'rgba(244,63,94,0.1)' : 'rgba(16,185,129,0.1)', border: `1px solid ${vaultCheckResult.isSpent ? 'var(--rose-accent)' : 'var(--emerald-accent)'}` }}>
                    <div style={{ fontWeight: 600, color: vaultCheckResult.isSpent ? 'var(--rose-accent)' : 'var(--emerald-accent)' }}>
                      {vaultCheckResult.isSpent ? '❌ Nullifier Spent (Vote Already Cast)' : '✅ Nullifier Available (Unvoted)'}
                    </div>
                    <div style={{ fontFamily: 'var(--font-code)', fontSize: '0.78rem', color: 'var(--text-dim)', marginTop: '0.3rem', wordBreak: 'break-all' }}>
                      Nullifier Hash: 0x{vaultCheckResult.nullifierHex}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 6: ANALYTICS & REPORTS */}
        {activeTab === 'analytics' && (
          <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ fontFamily: 'var(--font-heading)', fontSize: '1.8rem', marginBottom: '0.4rem' }}>
                  Governance Audit & Analytics Reports
                </h2>
                <p style={{ color: 'var(--text-muted)' }}>
                  Download on-chain proposal state data & privacy-preserving metrics.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '0.75rem' }}>
                <button className="btn-secondary" onClick={handleExportJSON}>
                  📥 Export JSON
                </button>
                <button className="btn-primary" onClick={handleExportCSV}>
                  📊 Export CSV Audit
                </button>
              </div>
            </div>

            {/* Audit Table */}
            <div className="glass-card" style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left', fontSize: '0.9rem' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--border-subtle)', color: 'var(--text-muted)' }}>
                    <th style={{ padding: '0.75rem 1rem' }}>Category</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Proposal Title</th>
                    <th style={{ padding: '0.75rem 1rem' }}>YES Tallies</th>
                    <th style={{ padding: '0.75rem 1rem' }}>NO Tallies</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Total Ballots</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Nullifiers Recorded</th>
                    <th style={{ padding: '0.75rem 1rem' }}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {proposals.map(p => {
                    const total = p.yesTally + p.noTally;
                    return (
                      <tr key={p.address} style={{ borderBottom: '1px solid var(--border-subtle)' }}>
                        <td style={{ padding: '0.85rem 1rem' }}><span className="category-tag">{p.category}</span></td>
                        <td style={{ padding: '0.85rem 1rem', fontWeight: 500 }}>{p.proposalText}</td>
                        <td style={{ padding: '0.85rem 1rem', color: 'var(--emerald-accent)', fontWeight: 600 }}>{p.yesTally}</td>
                        <td style={{ padding: '0.85rem 1rem', color: 'var(--rose-accent)', fontWeight: 600 }}>{p.noTally}</td>
                        <td style={{ padding: '0.85rem 1rem', fontWeight: 600 }}>{total}</td>
                        <td style={{ padding: '0.85rem 1rem', fontFamily: 'var(--font-code)', fontSize: '0.82rem' }}>{p.nullifiers.length}</td>
                        <td style={{ padding: '0.85rem 1rem' }}>
                          <span className={`status-badge ${p.votingOpen ? 'open' : 'closed'}`}>
                            {p.votingOpen ? 'Active' : 'Closed'}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </main>

      {/* VOTE MODAL */}
      {voteProposal && (
        <div className="modal-overlay" onClick={() => setVoteProposal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Cast Anonymous ZK Ballot</h3>
              <button className="close-btn" onClick={() => setVoteProposal(null)}>✕</button>
            </div>

            <div style={{ marginBottom: '1rem', background: 'rgba(255,255,255,0.03)', padding: '1rem', borderRadius: 'var(--radius-md)' }}>
              <span className="category-tag">{voteProposal.category}</span>
              <h4 style={{ fontFamily: 'var(--font-heading)', marginTop: '0.5rem' }}>{voteProposal.proposalText}</h4>
            </div>

            <form onSubmit={handleCastVote}>
              <div className="form-group">
                <label className="form-label">Your Vote Choice</label>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem' }}>
                  <button
                    type="button"
                    style={{
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      border: voteChoice ? '2px solid var(--emerald-accent)' : '1px solid var(--border-subtle)',
                      background: voteChoice ? 'rgba(16,185,129,0.15)' : 'rgba(255,255,255,0.03)',
                      color: 'var(--emerald-accent)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '1rem'
                    }}
                    onClick={() => setVoteChoice(true)}
                  >
                    🟢 YES (In Favor)
                  </button>

                  <button
                    type="button"
                    style={{
                      padding: '1rem',
                      borderRadius: 'var(--radius-md)',
                      border: !voteChoice ? '2px solid var(--rose-accent)' : '1px solid var(--border-subtle)',
                      background: !voteChoice ? 'rgba(244,63,94,0.15)' : 'rgba(255,255,255,0.03)',
                      color: 'var(--rose-accent)',
                      fontWeight: 700,
                      cursor: 'pointer',
                      fontSize: '1rem'
                    }}
                    onClick={() => setVoteChoice(false)}
                  >
                    🔴 NO (Against)
                  </button>
                </div>
              </div>

              <div className="form-group">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.4rem' }}>
                  <label className="form-label" style={{ margin: 0 }}>Voter Secret Witness Key (64 Hex)</label>
                  <button type="button" className="btn-secondary" style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem' }} onClick={() => setVoterSecretInput(generateRandomSecretHex())}>
                    Generate Key
                  </button>
                </div>
                <input
                  type="text"
                  className="form-control"
                  style={{ fontFamily: 'var(--font-code)', fontSize: '0.85rem' }}
                  value={voterSecretInput}
                  onChange={(e) => setVoterSecretInput(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setVoteProposal(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={isCastingVote}>
                  {isCastingVote ? 'Generating Proof...' : '⚡ Submit ZK Ballot'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* CLOSE VOTING MODAL */}
      {closeProposal && (
        <div className="modal-overlay" onClick={() => setCloseProposal(null)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h3 className="modal-title">Close Voting Period (Admin)</h3>
              <button className="close-btn" onClick={() => setCloseProposal(null)}>✕</button>
            </div>

            <p style={{ color: 'var(--text-muted)', fontSize: '0.9rem', marginBottom: '1.25rem' }}>
              Closing voting will prevent any further ballots from being submitted for this proposal.
            </p>

            <form onSubmit={handleCloseVotingSubmit}>
              <div className="form-group">
                <label className="form-label">Admin Secret Key</label>
                <input
                  type="password"
                  className="form-control"
                  style={{ fontFamily: 'var(--font-code)' }}
                  placeholder="Enter your 64-character Admin Secret Key"
                  value={adminSecretInput}
                  onChange={(e) => setAdminSecretInput(e.target.value)}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '1rem', marginTop: '1.5rem' }}>
                <button type="button" className="btn-secondary" onClick={() => setCloseProposal(null)}>
                  Cancel
                </button>
                <button type="submit" className="btn-outline-danger" disabled={isClosingVote}>
                  {isClosingVote ? 'Closing...' : '🔒 Close Voting'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Floating Toasts */}
      <div className="toast-container">
        {toasts.map(t => (
          <div key={t.id} className={`toast ${t.type}`}>
            <span>{t.type === 'success' ? '✅' : t.type === 'error' ? '❌' : 'ℹ️'}</span>
            <span>{t.message}</span>
          </div>
        ))}
      </div>

      <footer className="app-footer">
        Zyrex ZK Governance Protocol • Powered by Zero-Knowledge Cryptography & Shielded Proof Technology
      </footer>
    </div>
  );
}

export default App;

