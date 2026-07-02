/**
 * ClusterOS — Groq AI Analysis Integration
 *
 * Uses Groq API (llama-3.3-70b-versatile) to generate a professional,
 * explainable AI narration for every scheduling decision.
 *
 * Falls back to rule-based narration if the API call fails.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyDecision = any;

const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';
const GROQ_API_KEY = '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';
const GROQ_MODEL   = 'llama-3.3-70b-versatile';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AIAnalysisReport {
  executiveSummary:    string;
  selectionRationale:  string;
  performanceInsights: string;
  riskAssessment:      string;
  recommendations:     string[];
  comparisonNarrative: string;
  technicianNotes:     string;
  generatedBy:         'groq' | 'fallback';
  modelUsed?:          string;
  latencyMs?:          number;
}

// ─── Build structured prompt ─────────────────────────────────────────────────

function buildPrompt(decision: AnyDecision): string {
  const winner = decision.selectedNode;
  const winnerName = winner ? winner.hostname : 'None (No healthy nodes available)';
  const all    = decision.allScores || [];

  const nodeTable = all.length > 0
    ? all.map((n: any) => {
        const eliminated = decision.eliminatedNodes?.find((e: any) => e.nodeId === n.nodeId);
        return `
Node: ${n.hostname} (${n.nodeId.slice(0, 8)}...)
  Status: ${eliminated ? `ELIMINATED — ${eliminated.reason}` : 'Evaluated'}
  Final Score: ${n.totalScore.toFixed(4)} (Rank #${n.rank})
  CPU Usage: ${n.metrics.cpuUsage.toFixed(1)}% | RAM: ${n.metrics.ramUsage.toFixed(1)}% | GPU: ${n.metrics.gpuUsage.toFixed(1)}%
  CPU Temp: ${n.metrics.cpuTemp.toFixed(1)}°C | GPU Temp: ${n.metrics.gpuTemp.toFixed(1)}°C
  Network Latency: ${n.metrics.latencyMs.toFixed(0)}ms | Download: ${n.metrics.downloadMbps.toFixed(1)} Mbps
  Disk Usage: ${n.metrics.diskUsage.toFixed(1)}% | Read: ${n.metrics.diskReadMbps.toFixed(1)} MB/s | Write: ${n.metrics.diskWriteMbps.toFixed(1)} MB/s
  Running Tasks: ${n.metrics.runningTasks} | Queue: ${n.metrics.waitingTasks}
  Score Breakdown: CPU=${n.components.cpu.toFixed(2)}, RAM=${n.components.ram.toFixed(2)}, GPU=${n.components.gpu.toFixed(2)}, Temp=${n.components.temp.toFixed(2)}, Net=${n.components.network.toFixed(2)}, Queue=${n.components.queue.toFixed(2)}, Reliability=${n.components.reliability.toFixed(2)}, Disk=${n.components.disk.toFixed(2)}
  Average Performance Score: ${n.averagePerformance?.toFixed(2)} / 100
`.trim();
      }).join('\n\n')
    : '(No nodes passed health checks or were evaluated)';

  return `
You are ClusterOS AI, an enterprise-grade intelligent workload scheduler analyzer.
Your role is to produce a professional, accurate, and deeply insightful report explaining a scheduling decision.

=== SCHEDULING DECISION ===
Decision ID:     ${decision.decisionId}
Timestamp:       ${new Date(decision.timestamp).toISOString()}
Selected Node:   ${winnerName}
Confidence:      ${(decision.confidence ?? 0).toFixed(1)}%
Margin over 2nd: ${decision.scoreMargin?.toFixed(4) ?? 'N/A'}
Tiebreaker used: ${decision.tiebreakerUsed ?? 'None'}
Routing reason:  ${decision.routingReason}

=== SCHEDULER WEIGHTS ===
CPU: ${(decision.weights?.cpu ?? 0.30)*100}% | RAM: ${(decision.weights?.ram ?? 0.20)*100}% | GPU: ${(decision.weights?.gpu ?? 0.10)*100}%
Temperature: ${(decision.weights?.temp ?? 0.10)*100}% | Network: ${(decision.weights?.network ?? 0.10)*100}%
Queue: ${(decision.weights?.queue ?? 0.10)*100}% | Reliability: ${(decision.weights?.reliability ?? 0.05)*100}% | Disk: ${(decision.weights?.disk ?? 0.05)*100}%

=== ALL EVALUATED NODES ===
${nodeTable}

=== ELIMINATED NODES ===
${decision.eliminatedNodes?.map((e: any) => `${e.hostname}: ${e.reason}`).join('\n') ?? 'None'}

=== POSITIVE FACTS (why winner was selected) ===
${decision.positiveFacts?.join('\n') ?? 'Standard selection'}

=== TASK ===
Generate a comprehensive AI analysis report in the following exact JSON structure. Be specific, technical, and professional. Use actual numbers from the data. Avoid generic phrases.
In your selectionRationale, comparisonNarrative, and executiveSummary, make sure to describe the mathematical calculations (mentioning the individual metric values, their components, the Average Performance Score, and the weighted Final Score) to explain why the selected node was chosen as the best PC.

{
  "executiveSummary": "<2-3 sentence executive summary of what the scheduler did and why, including composite score and average performance>",
  "selectionRationale": "<3-4 sentence detailed technical rationale for selecting ${winner.hostname}, referencing specific metric values, component scores, and the Average Performance Score compared to others>",
  "performanceInsights": "<3-4 sentences about the performance landscape across all nodes — which metrics varied most, any bottlenecks, standout observations>",
  "riskAssessment": "<2-3 sentences about risks — thermal limits, network reliability, disk capacity, queue buildup — and how close the winner is to any thresholds>",
  "recommendations": ["<actionable recommendation 1>", "<actionable recommendation 2>", "<actionable recommendation 3>"],
  "comparisonNarrative": "<2-3 sentences comparing the winner with the runner-up — what made the difference, what the margin means>",
  "technicianNotes": "<1-2 sentences of technical notes for cluster administrators — hardware observations, unusual readings, or patterns worth monitoring>"
}

Return ONLY valid JSON, no markdown, no extra text.
`.trim();
}

// ─── Main AI Analysis Function ────────────────────────────────────────────────

export async function generateAIAnalysis(decision: AnyDecision): Promise<AIAnalysisReport> {
  const startMs = Date.now();

  try {
    const response = await fetch(GROQ_API_URL, {
      method:  'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${GROQ_API_KEY}`,
      },
      body: JSON.stringify({
        model:       GROQ_MODEL,
        messages:    [{ role: 'user', content: buildPrompt(decision) }],
        temperature: 0.3,       // low temp for accurate, factual output
        max_tokens:  1800,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Groq API error ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';
    const parsed  = JSON.parse(content);

    return {
      executiveSummary:    parsed.executiveSummary    ?? '',
      selectionRationale:  parsed.selectionRationale  ?? '',
      performanceInsights: parsed.performanceInsights ?? '',
      riskAssessment:      parsed.riskAssessment      ?? '',
      recommendations:     parsed.recommendations     ?? [],
      comparisonNarrative: parsed.comparisonNarrative ?? '',
      technicianNotes:     parsed.technicianNotes     ?? '',
      generatedBy:         'groq',
      modelUsed:           GROQ_MODEL,
      latencyMs:           Date.now() - startMs,
    };

  } catch (err) {
    console.warn('[ClusterOS AI] Groq API failed, using fallback analysis:', err);
    return buildFallbackAnalysis(decision, Date.now() - startMs);
  }
}

// ─── Fallback Rule-Based Analysis ─────────────────────────────────────────────

export function buildFallbackAnalysis(decision: AnyDecision, latencyMs = 0): AIAnalysisReport {
  if (!decision) {
    return {
      executiveSummary: 'No decision data available.',
      selectionRationale: 'Could not load scheduler breakdown details.',
      performanceInsights: '',
      riskAssessment: '',
      recommendations: [],
      comparisonNarrative: '',
      technicianNotes: '',
      generatedBy: 'fallback',
      latencyMs: 0,
    };
  }

  const winner = decision.selectedNode;
  const allScores = decision.allScores ?? [];
  const eliminatedNodes = decision.eliminatedNodes ?? [];

  if (!winner || allScores.length === 0) {
    return {
      executiveSummary: `No active PC nodes were selected. All ${eliminatedNodes.length} candidate node(s) were eliminated from scheduling due to health checks or offline status.`,
      selectionRationale: `The scheduler could not dispatch the workload because no healthy candidate nodes met the required execution criteria. Ensure that the ClusterOS agents are running on target devices and they are online.`,
      performanceInsights: eliminatedNodes.length > 0
        ? `All discovered nodes (${eliminatedNodes.map((n: any) => n.hostname || n.deviceName || n.nodeId).join(', ')}) are currently offline or reporting critical health issues.`
        : `No PC nodes were discovered in the cluster.`,
      riskAssessment: 'Critical status: cluster capacity is at zero. Workloads cannot be routed.',
      recommendations: [
        'Check network connectivity for all cluster nodes',
        'Verify that the ClusterOSAgent service is running on target PCs',
        'Ensure firewall rules allow scheduling agent communication'
      ],
      comparisonNarrative: 'No node comparison possible as all nodes are offline or eliminated.',
      technicianNotes: `Cluster OS Scheduler status - ZERO healthy nodes. Total considered: ${eliminatedNodes.length} (all eliminated).`,
      generatedBy: 'fallback',
      latencyMs,
    };
  }

  const allValid = decision.allScores.filter((n: any) => !decision.eliminatedNodes?.find((e: any) => e.nodeId === n.nodeId));
  const runnerUp = allValid.find((n: any) => n.rank === 2);

  const dominantFactor = getDominantFactor(winner);
  const margin = decision.scoreMargin ?? 0;
  const confidence = decision.confidence;

  return {
    executiveSummary: `The ClusterOS Intelligent Scheduler evaluated ${decision.allScores.length} node(s) using an 8-factor weighted scoring algorithm and selected ${winner.hostname} with a composite score of ${winner.totalScore.toFixed(4)} and an Average Performance Score of ${winner.averagePerformance?.toFixed(2)}/100, yielding ${confidence.toFixed(1)}% dispatch confidence. ${decision.eliminatedNodes?.length ?? 0} node(s) were eliminated before scoring due to health or threshold failures.`,

    selectionRationale: `${winner.hostname} achieved the highest availability score primarily due to ${dominantFactor}, with an Average Performance Score of ${winner.averagePerformance?.toFixed(2)}/100. Its CPU utilization of ${winner.metrics.cpuUsage.toFixed(1)}% (score: ${winner.components.cpu.toFixed(1)}) and RAM usage of ${winner.metrics.ramUsage.toFixed(1)}% (score: ${winner.components.ram.toFixed(1)}) indicate substantial idle capacity. With ${winner.metrics.runningTasks} active tasks and network latency of ${winner.metrics.latencyMs.toFixed(0)}ms, this node presents the lowest resource contention for the incoming workload.`,

    performanceInsights: `Across all evaluated nodes, CPU usage ranged from ${Math.min(...decision.allScores.map((n: any) => n.metrics.cpuUsage)).toFixed(1)}% to ${Math.max(...decision.allScores.map((n: any) => n.metrics.cpuUsage)).toFixed(1)}%. RAM availability and thermal headroom were the most differentiating factors. ${winner.metrics.cpuTemp > 70 ? `Thermal margins on ${winner.hostname} are moderate at ${winner.metrics.cpuTemp.toFixed(1)}°C — the scheduler applied temperature penalties accordingly.` : `${winner.hostname} operates well within thermal limits at ${winner.metrics.cpuTemp.toFixed(1)}°C CPU temperature.`}`,

    riskAssessment: `${winner.metrics.diskUsage > 80 ? `⚠️ Disk usage on ${winner.hostname} is elevated at ${winner.metrics.diskUsage.toFixed(1)}% — monitor for storage exhaustion.` : `Disk utilization is healthy at ${winner.metrics.diskUsage.toFixed(1)}%.`} ${winner.metrics.cpuTemp > 75 ? `CPU temperature of ${winner.metrics.cpuTemp.toFixed(1)}°C approaches throttling thresholds.` : `Thermal conditions are nominal.`} ${decision.confidence < 70 ? `Low confidence (${confidence.toFixed(1)}%) indicates nodes are similarly loaded — consider adding more nodes to improve scheduling precision.` : `Confidence is strong at ${confidence.toFixed(1)}%.`}`,

    recommendations: [
      runnerUp ? `Monitor ${runnerUp.hostname} as a hot-standby — score gap is only ${margin.toFixed(4)} points` : 'Consider adding a second node for redundancy',
      winner.metrics.ramUsage > 70 ? `Increase RAM on ${winner.hostname} — currently at ${winner.metrics.ramUsage.toFixed(1)}% usage` : `RAM on ${winner.hostname} is healthy; no immediate action needed`,
      winner.metrics.latencyMs > 50 ? `Investigate network latency on ${winner.hostname} (${winner.metrics.latencyMs.toFixed(0)}ms) — consider co-locating workloads` : `Network latency is acceptable at ${winner.metrics.latencyMs.toFixed(0)}ms`,
    ],

    comparisonNarrative: runnerUp
      ? `Compared to ${runnerUp.hostname} (score: ${runnerUp.totalScore.toFixed(4)}), ${winner.hostname} outperformed by a margin of ${margin.toFixed(4)} points. The primary differentiators were ${getDominantFactor(winner)} advantage. A margin above 0.05 indicates a clear winner; at ${margin.toFixed(4)}, this decision is ${margin > 0.05 ? 'decisive' : 'narrow — load balancing could be beneficial'}.`
      : `Only one node passed the elimination filters, making ${winner.hostname} the uncontested choice. Deploy additional cluster nodes to enable competitive scheduling.`,

    technicianNotes: `Scheduling engine v2.0 — Weights: CPU ${(decision.weights?.cpu ?? 0.30)*100}%, RAM ${(decision.weights?.ram ?? 0.20)*100}%, GPU ${(decision.weights?.gpu ?? 0.10)*100}%, Temp ${(decision.weights?.temp ?? 0.10)*100}%, Net ${(decision.weights?.network ?? 0.10)*100}%, Queue ${(decision.weights?.queue ?? 0.10)*100}%, Reliability ${(decision.weights?.reliability ?? 0.05)*100}%, Disk ${(decision.weights?.disk ?? 0.05)*100}%. Dispatcher decision ID: ${decision.decisionId}.`,

    generatedBy: 'fallback',
    latencyMs,
  };
}

function getDominantFactor(node: any): string {
  const components = node.components;
  const entries = Object.entries(components) as [string, number][];
  const best = entries.sort((a, b) => b[1] - a[1])[0];
  const map: Record<string, string> = {
    cpu:         'low CPU utilization',
    ram:         'available RAM headroom',
    gpu:         'GPU availability',
    temp:        'thermal efficiency',
    network:     'network performance',
    queue:       'minimal task queue depth',
    reliability: 'high reliability rating',
    disk:        'disk health and throughput',
  };
  return map[best[0]] ?? best[0];
}
