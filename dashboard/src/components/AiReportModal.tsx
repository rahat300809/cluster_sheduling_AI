'use client';

import { useState, useCallback, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { format } from 'date-fns';
import {
  X, Download, Cpu, MemoryStick, Zap, Thermometer,
  Wifi, ListTodo, ShieldCheck, HardDrive,
  Trophy, Clock, Activity, BarChart2, FileText,
  CheckCircle, XCircle, Loader2, Sparkles, AlertTriangle
} from 'lucide-react';
import type { SchedulerDecision, NodeScoreBreakdown } from '@/types';
import type { AIAnalysisReport } from '@/lib/groqAnalysis';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AiReportModalProps {
  decision: SchedulerDecision;
  jobName?: string;
  jobId?: string;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 80) return '#10b981'; // emerald
  if (score >= 60) return '#f59e0b'; // amber
  if (score >= 40) return '#f97316'; // orange
  return '#ef4444'; // red
}
function scoreClass(score: number) {
  if (score >= 80) return 'text-emerald-400';
  if (score >= 60) return 'text-amber-400';
  if (score >= 40) return 'text-orange-400';
  return 'text-red-400';
}
function scoreBg(score: number) {
  if (score >= 80) return 'bg-emerald-500/10 border-emerald-500/20';
  if (score >= 60) return 'bg-amber-500/10 border-amber-500/20';
  if (score >= 40) return 'bg-orange-500/10 border-orange-500/20';
  return 'bg-red-500/10 border-red-500/20';
}

function ScoreBar({ value, label, icon: Icon }: { value: number; label: string; icon: React.ElementType }) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="w-3 h-3 text-slate-500 flex-shrink-0" />
      <span className="text-[10px] text-slate-500 w-20 flex-shrink-0">{label}</span>
      <div className="flex-1 bg-slate-800 rounded-full h-1.5 overflow-hidden">
        <div
          className="h-full rounded-full transition-all"
          style={{ width: `${value}%`, backgroundColor: scoreColor(value) }}
        />
      </div>
      <span className="text-[10px] font-mono font-bold w-8 text-right" style={{ color: scoreColor(value) }}>
        {value.toFixed(0)}
      </span>
    </div>
  );
}

// ─── PDF Export (pure jsPDF — no html2canvas) ─────────────────────────────────

async function exportToPDF(
  inputDecision: SchedulerDecision,
  aiReport: AIAnalysisReport | null,
  jobName: string
) {
  const decision: SchedulerDecision = {
    timestamp: inputDecision?.timestamp ?? Date.now(),
    selectedDeviceId: inputDecision?.selectedDeviceId ?? '',
    selectedDeviceName: inputDecision?.selectedDeviceName ?? 'Unknown Device',
    finalScore: inputDecision?.finalScore ?? 0,
    rank: inputDecision?.rank ?? 1,
    totalConsidered: inputDecision?.totalConsidered ?? 1,
    confidence: inputDecision?.confidence ?? 100,
    routingReason: inputDecision?.routingReason ?? 'No details available.',
    positiveFacts: inputDecision?.positiveFacts ?? [],
    tiebroken: inputDecision?.tiebroken ?? false,
    weights: inputDecision?.weights ?? {
      cpu: 0.3, ram: 0.2, gpu: 0.1, temperature: 0.1, network: 0.1, queue: 0.1, reliability: 0.05, disk: 0.05
    },
    rankedNodes: Array.isArray(inputDecision?.rankedNodes) ? inputDecision.rankedNodes : [],
    eliminatedNodes: Array.isArray(inputDecision?.eliminatedNodes) ? inputDecision.eliminatedNodes : [],
    expectedCompletionMinutes: inputDecision?.expectedCompletionMinutes ?? 0,
  };

  const { jsPDF } = await import('jspdf');
  const autoTable  = (await import('jspdf-autotable')).default;

  const winner    = decision.rankedNodes[0];
  const timestamp = format(new Date(decision.timestamp), 'yyyy-MM-dd HH:mm:ss');
  const filename  = `ClusterOS_AI_Report_${jobName.replace(/\s+/g, '_')}_${format(new Date(decision.timestamp), 'yyyyMMdd_HHmmss')}.pdf`;

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const H   = pdf.internal.pageSize.getHeight();

  // ── Palette ───────────────────────────────────────────────────────────────
  const C = {
    bg:       [10, 15, 26]    as [number,number,number],
    navyDark: [13, 20, 40]    as [number,number,number],
    navy:     [15, 30, 65]    as [number,number,number],
    accent:   [52, 211, 153]  as [number,number,number],  // emerald
    accentDim:[20, 83, 60]    as [number,number,number],
    blue:     [99, 179, 237]  as [number,number,number],
    white:    [255,255,255]   as [number,number,number],
    dim:      [148,163,184]   as [number,number,number],
    muted:    [71, 85, 105]   as [number,number,number],
    red:      [239, 68, 68]   as [number,number,number],
    amber:    [245,158, 11]   as [number,number,number],
    rowA:     [15, 23, 42]    as [number,number,number],
    rowB:     [20, 30, 55]    as [number,number,number],
    border:   [30, 50, 90]    as [number,number,number],
  };

  let pageNum = 1;

  function addPageBg() {
    pdf.setFillColor(...C.bg);
    pdf.rect(0, 0, W, H, 'F');
    // Subtle top gradient strip
    pdf.setFillColor(...C.navy);
    pdf.rect(0, 0, W, 18, 'F');
  }

  function addFooter() {
    pdf.setFontSize(7);
    pdf.setTextColor(...C.muted);
    const total = (pdf as any).getNumberOfPages?.() ?? pageNum;
    pdf.text(
      `ClusterOS Intelligent Scheduler  ·  Confidential  ·  Generated ${timestamp}  ·  Page ${pageNum}`,
      W / 2, H - 6, { align: 'center' }
    );
    pageNum++;
  }

  function addSectionHeader(label: string, y: number): number {
    pdf.setFillColor(...C.navy);
    pdf.roundedRect(10, y, W - 20, 7, 1, 1, 'F');
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...C.accent);
    pdf.text(`▶  ${label.toUpperCase()}`, 14, y + 4.8);
    return y + 10;
  }

  // ════════════════════════════════════════════════════════════
  // PAGE 1 — Header + Executive Summary + Routing Reason
  // ════════════════════════════════════════════════════════════
  addPageBg();

  // Header bar
  pdf.setFillColor(...C.navy);
  pdf.rect(0, 0, W, 20, 'F');

  // Logo / Title
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...C.accent);
  pdf.text('ClusterOS', 12, 12);
  pdf.setFontSize(9);
  pdf.setTextColor(...C.white);
  pdf.text('Intelligent Scheduler — AI Analysis Report', 42, 12);

  // Timestamp right-aligned
  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...C.dim);
  pdf.text(timestamp, W - 12, 12, { align: 'right' });

  // Job name sub-line
  pdf.setFontSize(8);
  pdf.setTextColor(...C.dim);
  pdf.text(`Job: ${jobName}   ·   Decision ID: ${decision.timestamp}`, 12, 17);

  let y = 26;

  // ── SUMMARY CARDS ────────────────────────────────────────────────────────
  const cardW  = (W - 30) / 4;
  const cards = [
    { label: 'SELECTED NODE', value: winner?.deviceName ?? '—', sub: `Score: ${decision.finalScore.toFixed(2)}/100` },
    { label: 'CONFIDENCE',    value: `${decision.confidence}%`,  sub: decision.tiebroken ? `Tiebreaker: ${decision.tiebreakMethod}` : 'Direct selection' },
    { label: 'NODES EVALUATED', value: `${decision.totalConsidered + decision.eliminatedNodes.length}`,  sub: `${decision.eliminatedNodes.length} eliminated` },
    { label: 'EST. COMPLETION', value: `~${decision.expectedCompletionMinutes ?? 5} min`, sub: `${winner?.runningTasks ?? 0} tasks running` },
  ];

  cards.forEach((card, i) => {
    const cx = 10 + i * (cardW + 2.5);
    pdf.setFillColor(...C.navyDark);
    pdf.setDrawColor(...C.border);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(cx, y, cardW, 20, 1.5, 1.5, 'FD');

    pdf.setFontSize(6.5);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...C.dim);
    pdf.text(card.label, cx + cardW / 2, y + 5.5, { align: 'center' });

    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...C.accent);
    const valStr = card.value.length > 14 ? card.value.slice(0, 13) + '…' : card.value;
    pdf.text(valStr, cx + cardW / 2, y + 13, { align: 'center' });

    pdf.setFontSize(6.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...C.muted);
    pdf.text(card.sub, cx + cardW / 2, y + 18, { align: 'center' });
  });
  y += 24;

  // ── AI NARRATIVE SECTIONS ──────────────────────────────────────────────
  if (aiReport) {
    y = addSectionHeader('Executive Summary', y);
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...C.white);
    const summaryLines = pdf.splitTextToSize(aiReport.executiveSummary, W - 24);
    pdf.text(summaryLines, 14, y);
    y += summaryLines.length * 4.5 + 4;

    if (aiReport.generatedBy === 'groq') {
      pdf.setFontSize(6.5);
      pdf.setTextColor(...C.accent);
      pdf.text(`✦ AI-powered analysis by ${aiReport.modelUsed} · Generated in ${aiReport.latencyMs}ms`, 14, y);
      y += 6;
    }

    y = addSectionHeader('Selection Rationale', y);
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...C.white);
    const rationaleLines = pdf.splitTextToSize(aiReport.selectionRationale, W - 24);
    pdf.text(rationaleLines, 14, y);
    y += rationaleLines.length * 4.5 + 4;

    y = addSectionHeader('Risk Assessment', y);
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...C.white);
    const riskLines = pdf.splitTextToSize(aiReport.riskAssessment, W - 24);
    pdf.text(riskLines, 14, y);
    y += riskLines.length * 4.5 + 4;
  } else {
    // Routing reason fallback
    y = addSectionHeader('Routing Decision', y);
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...C.white);
    const routingLines = pdf.splitTextToSize(decision.routingReason, W - 24);
    pdf.text(routingLines, 14, y);
    y += routingLines.length * 4.5 + 4;
  }

  // ── POSITIVE FACTS ──────────────────────────────────────────────────────
  y = addSectionHeader('Contributing Factors (Winner Selection)', y);
  decision.positiveFacts.forEach((fact, i) => {
    pdf.setFontSize(8);
    pdf.setTextColor(...C.accent);
    pdf.text('✓', 15, y);
    pdf.setTextColor(...C.white);
    pdf.text(fact, 21, y);
    y += 5;
  });
  y += 3;

  // ── RECOMMENDATIONS ──────────────────────────────────────────────────────
  if (aiReport?.recommendations?.length) {
    if (y > H - 50) { pdf.addPage(); addPageBg(); y = 26; }
    y = addSectionHeader('AI Recommendations', y);
    aiReport.recommendations.forEach((rec, i) => {
      pdf.setFontSize(8);
      pdf.setTextColor(...C.amber);
      pdf.text(`${i + 1}.`, 15, y);
      pdf.setTextColor(...C.white);
      const recLines = pdf.splitTextToSize(rec, W - 30);
      pdf.text(recLines, 22, y);
      y += recLines.length * 4.5 + 2;
    });
  }

  addFooter();

  // ════════════════════════════════════════════════════════════
  // PAGE 2 — Full Node Comparison Table
  // ════════════════════════════════════════════════════════════
  pdf.addPage();
  addPageBg();

  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...C.accent);
  pdf.text('Node Comparison — Full Metric Breakdown', 12, 14);
  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...C.dim);
  pdf.text(`Scheduler Weights: CPU ${(decision.weights.cpu*100).toFixed(0)}%  RAM ${(decision.weights.ram*100).toFixed(0)}%  GPU ${(decision.weights.gpu*100).toFixed(0)}%  Temp ${(decision.weights.temperature*100).toFixed(0)}%  Net ${(decision.weights.network*100).toFixed(0)}%  Queue ${(decision.weights.queue*100).toFixed(0)}%  Reliability ${(decision.weights.reliability*100).toFixed(0)}%  Disk ${(decision.weights.disk*100).toFixed(0)}%`, 12, 20);

  // All scored nodes table
  const allNodes = [...decision.rankedNodes, ...decision.eliminatedNodes];

  autoTable(pdf, {
    startY: 25,
    head: [[
      'Rank', 'Node', 'CPU%', 'RAM%', 'GPU%',
      'CPU°C', 'Latency', 'Tasks',
      'Disk%', 'Avg Perf', 'Final Score', 'Status'
    ]],
    body: allNodes.map((n, i) => {
      const rank = n.eliminated ? 'ELIM' : `#${decision.rankedNodes.findIndex(r => r.deviceId === n.deviceId) + 1}`;
      return [
        rank,
        (n.deviceName || n.deviceId.slice(0, 8)).slice(0, 16),
        `${(n.cpuUsage ?? 0).toFixed(0)}%`,
        `${(n.ramUsage ?? 0).toFixed(0)}%`,
        `${(n.gpuUsage ?? 0).toFixed(0)}%`,
        `${(n.cpuTemp  ?? 0).toFixed(0)}C`,
        `${(n.latencyMs ?? 0).toFixed(0)}ms`,
        `${n.runningTasks ?? 0}/${n.waitingTasks ?? 0}`,
        `${(n.diskUsage  ?? 0).toFixed(0)}%`,
        n.eliminated ? '—' : (n.averagePerformance ?? 0).toFixed(1),
        n.eliminated ? '—' : (n.finalScore ?? 0).toFixed(1),
        n.eliminated ? 'ELIMINATED' : (n.deviceId === decision.selectedDeviceId ? 'SELECTED ✓' : 'Evaluated'),
      ];
    }),
    theme: 'plain',
    styles: {
      fontSize: 6.5,
      cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
      textColor: [220, 230, 245],
      lineColor: [30, 50, 90],
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: C.navy,
      textColor: C.accent,
      fontStyle: 'bold',
      fontSize: 6.5,
    },
    alternateRowStyles: { fillColor: C.rowB },
    bodyStyles: { fillColor: C.rowA },
    didParseCell: (data: any) => {
      // Highlight winner row
      const rowNode = allNodes[data.row.index];
      if (rowNode?.deviceId === decision.selectedDeviceId) {
        data.cell.styles.fillColor = [15, 60, 40];
        data.cell.styles.textColor = C.accent;
        data.cell.styles.fontStyle = 'bold';
      }
      // Red for eliminated
      if (rowNode?.eliminated) {
        data.cell.styles.textColor = [239, 68, 68];
        data.cell.styles.fillColor = [40, 15, 15];
      }
    },
    margin: { left: 10, right: 10 },
  });

  let yAfterTable: number = ((pdf as any).lastAutoTable?.finalY as number | undefined) != null ? (pdf as any).lastAutoTable.finalY : 120;
  yAfterTable += 8;

  // ── Score Breakdown Sub-table ─────────────────────────────────────────────
  if (yAfterTable < H - 60) {
    pdf.setFontSize(9);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...C.accent);
    pdf.text('Score Component Breakdown (Scored Nodes Only)', 12, yAfterTable);
    yAfterTable += 5;

    autoTable(pdf, {
      startY: yAfterTable,
      head: [['Node', 'CPU Sc', 'RAM Sc', 'GPU Sc', 'Temp Sc', 'Net Sc', 'Queue Sc', 'Rel. Sc', 'Disk Sc', 'Avg Perf', 'FINAL']],
      body: decision.rankedNodes.map(n => [
        (n.deviceName || n.deviceId.slice(0, 8)).slice(0, 16),
        (n.cpuScore        ?? 0).toFixed(0),
        (n.ramScore        ?? 0).toFixed(0),
        (n.gpuScore        ?? 0).toFixed(0),
        (n.temperatureScore ?? 0).toFixed(0),
        (n.networkScore    ?? 0).toFixed(0),
        (n.queueScore      ?? 0).toFixed(0),
        (n.reliabilityScore ?? 0).toFixed(0),
        (n.diskScore       ?? 0).toFixed(0),
        (n.averagePerformance ?? 0).toFixed(1),
        (n.finalScore      ?? 0).toFixed(1),
      ]),
      theme: 'plain',
      styles: {
        fontSize: 6.5,
        cellPadding: { top: 2, right: 2, bottom: 2, left: 2 },
        textColor: [220, 230, 245],
        lineColor: [30, 50, 90],
        lineWidth: 0.25,
      },
      headStyles: {
        fillColor: C.navy,
        textColor: C.blue,
        fontStyle: 'bold',
        fontSize: 6.5,
      },
      alternateRowStyles: { fillColor: C.rowB },
      bodyStyles: { fillColor: C.rowA },
      didParseCell: (data: any) => {
        if (decision.rankedNodes[data.row.index]?.deviceId === decision.selectedDeviceId) {
          data.cell.styles.fillColor = [15, 60, 40];
          data.cell.styles.textColor = C.accent;
          data.cell.styles.fontStyle = 'bold';
        }
        // Highlight FINAL column
        if (data.column.index === 10) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: 10, right: 10 },
    });
  }

  addFooter();

  // ════════════════════════════════════════════════════════════
  // PAGE 3 — Eliminated Nodes + Weights + Technician Notes
  // ════════════════════════════════════════════════════════════
  pdf.addPage();
  addPageBg();

  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...C.accent);
  pdf.text('Eliminated Nodes & Configuration', 12, 14);

  let y3 = 22;

  // ── Eliminated nodes ─────────────────────────────────────────────────────
  y3 = addSectionHeader('Eliminated Nodes (Health Check Failures)', y3);

  if (decision.eliminatedNodes.length > 0) {
    autoTable(pdf, {
      startY: y3,
      head: [['Node', 'Device ID', 'CPU%', 'RAM%', 'CPU°C', 'Status', 'Elimination Reason']],
      body: decision.eliminatedNodes.map(n => [
        (n.deviceName || '—').slice(0, 18),
        (n.deviceId || '—').slice(0, 12),
        (n.cpuUsage ?? 0).toFixed(1),
        (n.ramUsage ?? 0).toFixed(1),
        (n.cpuTemp  ?? 0).toFixed(0),
        n.healthStatus ?? 'unknown',
        n.eliminationReason ?? 'Unknown reason',
      ]),
      theme: 'plain',
      styles: {
        fontSize: 7,
        cellPadding: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
        textColor: [239, 68, 68],
        lineColor: [80, 20, 20],
        lineWidth: 0.25,
      },
      headStyles: {
        fillColor: [50, 15, 15],
        textColor: [252, 165, 165],
        fontStyle: 'bold',
        fontSize: 7,
      },
      bodyStyles: { fillColor: [30, 10, 10] },
      alternateRowStyles: { fillColor: [40, 12, 12] },
      margin: { left: 10, right: 10 },
    });
    y3 = ((pdf as any).lastAutoTable?.finalY as number | undefined) != null ? (pdf as any).lastAutoTable.finalY + 8 : y3 + 20;
  } else {
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(...C.dim);
    pdf.text('No nodes were eliminated — all discovered nodes passed health checks.', 14, y3);
    y3 += 10;
  }

  // ── Scheduler Weight Configuration ───────────────────────────────────────
  y3 = addSectionHeader('Active Scheduler Weight Configuration', y3);

  const weightRows = [
    ['CPU Availability',          `${(decision.weights.cpu * 100).toFixed(0)}%`,          'Primary scheduling factor — how busy the processor is'],
    ['RAM Availability',          `${(decision.weights.ram * 100).toFixed(0)}%`,          'Available memory headroom for new workloads'],
    ['GPU Availability',          `${(decision.weights.gpu * 100).toFixed(0)}%`,          'GPU compute + VRAM utilization combined score'],
    ['Temperature Safety',        `${(decision.weights.temperature * 100).toFixed(0)}%`,  'CPU and GPU thermal margin before throttling'],
    ['Network Quality',           `${(decision.weights.network * 100).toFixed(0)}%`,      'Latency (70%) + download throughput (30%)'],
    ['Task Queue Depth',          `${(decision.weights.queue * 100).toFixed(0)}%`,        'Penalizes nodes with many running/waiting tasks'],
    ['Historical Reliability',    `${(decision.weights.reliability * 100).toFixed(0)}%`,  'Job success rate over time'],
    ['Disk Health & I/O',         `${(decision.weights.disk * 100).toFixed(0)}%`,         'Disk usage (50%) + read/write throughput (50%)'],
  ];

  autoTable(pdf, {
    startY: y3,
    head: [['Metric', 'Weight', 'Description']],
    body: weightRows,
    theme: 'plain',
    styles: {
      fontSize: 7.5,
      cellPadding: { top: 2.5, right: 2.5, bottom: 2.5, left: 2.5 },
      textColor: [220, 230, 245],
      lineColor: C.border,
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: C.navy,
      textColor: C.accent,
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 42 },
      1: { halign: 'center', cellWidth: 18, textColor: C.accent, fontStyle: 'bold' },
      2: { textColor: C.dim },
    },
    alternateRowStyles: { fillColor: C.rowB },
    bodyStyles: { fillColor: C.rowA },
    margin: { left: 10, right: 10 },
  });

  y3 = ((pdf as any).lastAutoTable?.finalY as number | undefined) != null ? (pdf as any).lastAutoTable.finalY + 8 : y3 + 60;

  // ── Performance Insights + Technician Notes ─────────────────────────────
  if (aiReport) {
    if (aiReport.performanceInsights) {
      y3 = addSectionHeader('Performance Insights', y3);
      pdf.setFontSize(8.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...C.white);
      const insightLines = pdf.splitTextToSize(aiReport.performanceInsights, W - 24);
      pdf.text(insightLines, 14, y3);
      y3 += insightLines.length * 4.5 + 4;
    }
    if (aiReport.comparisonNarrative && decision.rankedNodes.length > 1) {
      y3 = addSectionHeader('Node Comparison Narrative', y3);
      pdf.setFontSize(8.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...C.white);
      const compLines = pdf.splitTextToSize(aiReport.comparisonNarrative, W - 24);
      pdf.text(compLines, 14, y3);
      y3 += compLines.length * 4.5 + 4;
    }
    if (aiReport.technicianNotes) {
      y3 = addSectionHeader('Technician Notes', y3);
      pdf.setFontSize(8.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...C.dim);
      const techLines = pdf.splitTextToSize(aiReport.technicianNotes, W - 24);
      pdf.text(techLines, 14, y3);
      y3 += techLines.length * 4.5 + 4;
    }
  }

  addFooter();

  // ── Save ─────────────────────────────────────────────────────────────────
  pdf.save(filename);
}

// ─── CSV Export ───────────────────────────────────────────────────────────────

function exportToCSV(decision: SchedulerDecision, jobName: string) {
  const headers = [
    'Rank','Node','DeviceID','CPU%','RAM%','GPU%','GPU_Mem%',
    'CPU_Temp_C','GPU_Temp_C','Latency_ms','Download_Mbps','Upload_Mbps',
    'Disk%','DiskRead_MBps','DiskWrite_MBps','RunningTasks','WaitingTasks',
    'Uptime_Hours','SuccessRate','CPU_Score','RAM_Score','GPU_Score',
    'Temp_Score','Net_Score','Queue_Score','Rel_Score','Disk_Score',
    'Final_Score','Status','Health','Eliminated','ElimReason'
  ];

  const allNodes = [...decision.rankedNodes, ...decision.eliminatedNodes];
  const rows = allNodes.map((n, i) => [
    n.eliminated ? 'ELIM' : String(decision.rankedNodes.findIndex(r => r.deviceId === n.deviceId) + 1),
    n.deviceName, n.deviceId,
    n.cpuUsage?.toFixed(2), n.ramUsage?.toFixed(2), n.gpuUsage?.toFixed(2), (n as any).gpuMemUsed?.toFixed(2) ?? '0',
    n.cpuTemp?.toFixed(1), n.gpuTemp?.toFixed(1), n.latencyMs?.toFixed(0),
    n.downloadMbps?.toFixed(2), n.uploadMbps?.toFixed(2),
    n.diskUsage?.toFixed(2), n.diskReadMbps?.toFixed(2), n.diskWriteMbps?.toFixed(2),
    n.runningTasks, n.waitingTasks,
    n.uptimeHours?.toFixed(2), n.successRate?.toFixed(1),
    n.cpuScore?.toFixed(2), n.ramScore?.toFixed(2), n.gpuScore?.toFixed(2),
    n.temperatureScore?.toFixed(2), n.networkScore?.toFixed(2), n.queueScore?.toFixed(2),
    n.reliabilityScore?.toFixed(2), n.diskScore?.toFixed(2),
    n.finalScore?.toFixed(4),
    n.status, n.healthStatus,
    n.eliminated ? 'YES' : 'NO',
    `"${n.eliminationReason ?? ''}"`,
  ]);

  const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `ClusterOS_Report_${jobName.replace(/\s+/g,'_')}_${decision.timestamp}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Main Modal ───────────────────────────────────────────────────────────────

export default function AiReportModal({ decision: inputDecision, jobName = 'Unnamed Job', jobId, onClose }: AiReportModalProps) {
  const decision: SchedulerDecision = {
    timestamp: inputDecision?.timestamp ?? Date.now(),
    selectedDeviceId: inputDecision?.selectedDeviceId ?? '',
    selectedDeviceName: inputDecision?.selectedDeviceName ?? 'Unknown Device',
    finalScore: inputDecision?.finalScore ?? 0,
    rank: inputDecision?.rank ?? 1,
    totalConsidered: inputDecision?.totalConsidered ?? 1,
    confidence: inputDecision?.confidence ?? 100,
    routingReason: inputDecision?.routingReason ?? 'No details available.',
    positiveFacts: inputDecision?.positiveFacts ?? [],
    tiebroken: inputDecision?.tiebroken ?? false,
    weights: inputDecision?.weights ?? {
      cpu: 0.3, ram: 0.2, gpu: 0.1, temperature: 0.1, network: 0.1, queue: 0.1, reliability: 0.05, disk: 0.05
    },
    rankedNodes: Array.isArray(inputDecision?.rankedNodes) ? inputDecision.rankedNodes : [],
    eliminatedNodes: Array.isArray(inputDecision?.eliminatedNodes) ? inputDecision.eliminatedNodes : [],
    expectedCompletionMinutes: inputDecision?.expectedCompletionMinutes ?? 0,
  };

  const [aiReport, setAiReport]       = useState<AIAnalysisReport | null>(null);
  const [aiLoading, setAiLoading]     = useState(true);
  const [aiError, setAiError]         = useState<string | null>(null);
  const [pdfLoading, setPdfLoading]   = useState(false);
  const [activeTab, setActiveTab]     = useState<'overview' | 'nodes' | 'config'>('overview');

  const winner   = decision.rankedNodes[0];
  const runnerUp = decision.rankedNodes[1];

  // ── Fetch Groq AI Analysis on mount ──────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    setAiLoading(true);
    setAiError(null);

    // Build SchedulerDecision in the shape groqAnalysis expects
    const decisionForAI = {
      ...decision,
      decisionId:    String(decision.timestamp),
      selectedNode:  { ...winner, hostname: winner?.deviceName ?? 'Unknown', nodeId: winner?.deviceId ?? '' },
      allScores:     decision.rankedNodes.map(n => ({
        ...n,
        nodeId:   n.deviceId,
        hostname: n.deviceName,
        rank:     decision.rankedNodes.findIndex(r => r.deviceId === n.deviceId) + 1,
        metrics: {
          cpuUsage:      n.cpuUsage,
          ramUsage:      n.ramUsage,
          gpuUsage:      n.gpuUsage,
          cpuTemp:       n.cpuTemp,
          gpuTemp:       n.gpuTemp,
          latencyMs:     n.latencyMs,
          downloadMbps:  n.downloadMbps,
          diskUsage:     n.diskUsage,
          diskReadMbps:  n.diskReadMbps,
          diskWriteMbps: n.diskWriteMbps,
          runningTasks:  n.runningTasks,
          waitingTasks:  n.waitingTasks,
        },
        components: {
          cpu:         n.cpuScore,
          ram:         n.ramScore,
          gpu:         n.gpuScore,
          temp:        n.temperatureScore,
          network:     n.networkScore,
          queue:       n.queueScore,
          reliability: n.reliabilityScore,
          disk:        n.diskScore,
        },
        totalScore: n.finalScore,
        averagePerformance: n.averagePerformance,
      })),
      eliminatedNodes: decision.eliminatedNodes.map(n => ({
        ...n,
        nodeId:   n.deviceId,
        hostname: n.deviceName,
        reason:   n.eliminationReason ?? 'Unknown',
      })),
      scoreMargin:   winner && runnerUp ? winner.finalScore - runnerUp.finalScore : 0,
      tiebreakerUsed: decision.tiebroken ? decision.tiebreakMethod : null,
    };

    import('@/lib/groqAnalysis').then(({ generateAIAnalysis }) => {
      generateAIAnalysis(decisionForAI as any)
        .then(report => {
          if (!cancelled) {
            setAiReport(report);
            setAiLoading(false);
          }
        })
        .catch(err => {
          if (!cancelled) {
            setAiError(String(err));
            setAiLoading(false);
          }
        });
    });

    return () => { cancelled = true; };
  }, [decision]);

  const handlePDFExport = useCallback(async () => {
    setPdfLoading(true);
    try {
      await exportToPDF(decision, aiReport, jobName);
    } finally {
      setPdfLoading(false);
    }
  }, [decision, aiReport, jobName]);

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[200] flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)' }}
        onClick={(e) => e.target === e.currentTarget && onClose()}
      >
        <motion.div
          initial={{ scale: 0.93, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 10 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="relative w-full max-w-5xl max-h-[92vh] flex flex-col overflow-hidden rounded-2xl border"
          style={{ background: 'linear-gradient(135deg,#080d1a 0%,#0a1628 100%)', borderColor: 'rgba(52,211,153,0.2)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b" style={{ borderColor: 'rgba(52,211,153,0.15)', background: 'rgba(15,30,65,0.8)' }}>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/20 flex items-center justify-center">
                <Sparkles className="w-4 h-4 text-emerald-400" />
              </div>
              <div>
                <h2 className="font-bold text-white text-sm">AI Scheduling Report</h2>
                <p className="text-xs text-slate-400">{jobName} · {format(new Date(decision.timestamp), 'MMM d, yyyy HH:mm:ss')}</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              {/* Export CSV */}
              <button
                onClick={() => exportToCSV(decision, jobName)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-slate-300 bg-slate-800 hover:bg-slate-700 transition-colors border border-slate-700"
              >
                <FileText className="w-3.5 h-3.5" />
                CSV
              </button>
              {/* Export PDF */}
              <button
                onClick={handlePDFExport}
                disabled={pdfLoading}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-white transition-all border"
                style={{ background: pdfLoading ? 'rgba(52,211,153,0.2)' : 'rgba(52,211,153,0.25)', borderColor: 'rgba(52,211,153,0.4)' }}
              >
                {pdfLoading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                {pdfLoading ? 'Exporting…' : 'PDF Report'}
              </button>
              <button onClick={onClose} className="w-7 h-7 rounded-lg bg-slate-800 hover:bg-slate-700 flex items-center justify-center border border-slate-700 transition-colors">
                <X className="w-3.5 h-3.5 text-slate-400" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b px-6" style={{ borderColor: 'rgba(52,211,153,0.1)' }}>
            {([
              { id: 'overview', label: 'AI Overview', icon: Sparkles },
              { id: 'nodes',    label: 'Node Comparison', icon: BarChart2 },
              { id: 'config',   label: 'Weights & Config', icon: Activity },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-2.5 text-xs font-medium border-b-2 transition-all ${
                  activeTab === tab.id
                    ? 'text-emerald-400 border-emerald-400'
                    : 'text-slate-500 border-transparent hover:text-slate-300'
                }`}
              >
                <tab.icon className="w-3 h-3" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-6 space-y-5">

            {/* ── Summary Cards (always visible) ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {[
                { label: 'Selected Node',   value: winner?.deviceName ?? '—',               icon: Trophy,  color: 'text-emerald-400' },
                { label: 'Final Score',     value: `${decision.finalScore.toFixed(2)}/100`, icon: BarChart2, color: 'text-blue-400' },
                { label: 'Confidence',      value: `${decision.confidence}%`,               icon: ShieldCheck, color: 'text-purple-400' },
                { label: 'Est. Completion', value: `~${decision.expectedCompletionMinutes ?? 5} min`, icon: Clock, color: 'text-amber-400' },
              ].map((card) => (
                <div key={card.label} className="rounded-xl p-4 border" style={{ background: 'rgba(15,23,42,0.8)', borderColor: 'rgba(52,211,153,0.12)' }}>
                  <div className="flex items-center gap-2 mb-1">
                    <card.icon className={`w-3.5 h-3.5 ${card.color}`} />
                    <span className="text-[10px] text-slate-500 uppercase tracking-wider">{card.label}</span>
                  </div>
                  <p className={`text-lg font-bold ${card.color} truncate`}>{card.value}</p>
                </div>
              ))}
            </div>

            {/* ── OVERVIEW TAB ── */}
            {activeTab === 'overview' && (
              <div className="space-y-4">
                {/* AI Overview Performance Table */}
                <div className="rounded-xl border border-slate-700 bg-slate-900/90 p-5 overflow-hidden shadow-2xl">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 mb-4">
                    <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider flex items-center gap-1.5">
                        <BarChart2 className="w-4 h-4 text-emerald-400" /> PC Performance Comparison Matrix
                      </h3>
                      <p className="text-[10px] text-slate-300 mt-0.5">Real-time metrics, normalized factor scores, arithmetic average performance (equal weights), and weighted scheduler composite final score.</p>
                    </div>
                    <div className="text-[10px] text-slate-200 bg-slate-950 px-3 py-1.5 rounded-lg border border-slate-700 font-mono self-start md:self-auto">
                      Formula: Avg Score = (CPU + RAM + GPU + Temp + Net + Queue + Rel. + Disk) / 8
                    </div>
                  </div>

                  <div className="overflow-x-auto -mx-5 px-5">
                    <table className="w-full text-left text-xs border-collapse min-w-[800px]">
                      <thead>
                        <tr className="border-b-2 border-slate-600 text-slate-100 text-[10px] font-extrabold uppercase tracking-wider bg-slate-950/70">
                          <th className="py-3 px-3">PC Node</th>
                          <th className="py-3 px-2">CPU</th>
                          <th className="py-3 px-2">RAM</th>
                          <th className="py-3 px-2">GPU</th>
                          <th className="py-3 px-2">SSD/Disk</th>
                          <th className="py-3 px-2">Network</th>
                          <th className="py-3 px-2 text-center">Avg Perf</th>
                          <th className="py-3 px-2 text-center">Final Score</th>
                          <th className="py-3 px-3 text-right">Selection</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/80 bg-slate-900/40">
                        {[...decision.rankedNodes, ...decision.eliminatedNodes].map((node) => {
                          const isWinner = node.deviceId === decision.selectedDeviceId;
                          const isElim = node.eliminated;
                          const avgPerf = node.averagePerformance ?? 0;
                          
                          return (
                            <tr 
                              key={node.deviceId}
                              className={`transition-colors hover:bg-slate-800/80 ${
                                isWinner 
                                  ? 'bg-emerald-950/40 text-white font-semibold' 
                                  : isElim 
                                    ? 'bg-red-950/20 text-red-200' 
                                    : 'text-slate-100'
                              }`}
                            >
                              {/* PC Node */}
                              <td className="py-3 px-3 border-b border-slate-800">
                                <div className="flex items-center gap-2.5">
                                  {isWinner ? (
                                    <div className="w-5 h-5 rounded-full bg-emerald-500/30 flex items-center justify-center border border-emerald-400">
                                      <Trophy className="w-3 h-3 text-emerald-300" />
                                    </div>
                                  ) : isElim ? (
                                    <div className="w-5 h-5 rounded-full bg-red-500/30 flex items-center justify-center border border-red-400">
                                      <XCircle className="w-3 h-3 text-red-400" />
                                    </div>
                                  ) : (
                                    <div className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-300 border border-slate-700">
                                      C
                                    </div>
                                  )}
                                  <div>
                                    <span className="font-bold text-xs block text-slate-50">{node.deviceName}</span>
                                    <span className="text-[9px] text-slate-400 font-mono tracking-tighter truncate max-w-[150px] block">{node.deviceId}</span>
                                  </div>
                                </div>
                              </td>

                              {/* CPU */}
                              <td className="py-3 px-2 border-b border-slate-800">
                                <div className="font-mono">
                                  <span className="font-bold text-slate-50 block">{node.cpuUsage.toFixed(0)}%</span>
                                  <span className="block text-[9px] text-slate-300">{node.cpuTemp.toFixed(0)}°C</span>
                                  <span className="block text-[9px] text-emerald-400 font-bold">Sc: {node.cpuScore.toFixed(0)}</span>
                                </div>
                              </td>

                              {/* RAM */}
                              <td className="py-3 px-2 border-b border-slate-800">
                                <div className="font-mono">
                                  <span className="font-bold text-slate-50 block">{node.ramUsage.toFixed(0)}%</span>
                                  <span className="block text-[9px] text-slate-300">Uptime: {node.uptimeHours.toFixed(1)}h</span>
                                  <span className="block text-[9px] text-emerald-400 font-bold">Sc: {node.ramScore.toFixed(0)}</span>
                                </div>
                              </td>

                              {/* GPU */}
                              <td className="py-3 px-2 border-b border-slate-800">
                                <div className="font-mono">
                                  <span className="font-bold text-slate-50 block">{node.gpuUsage.toFixed(0)}%</span>
                                  <span className="block text-[9px] text-slate-300">{node.gpuTemp.toFixed(0)}°C</span>
                                  <span className="block text-[9px] text-emerald-400 font-bold">Sc: {node.gpuScore.toFixed(0)}</span>
                                </div>
                              </td>

                              {/* SSD/Disk */}
                              <td className="py-3 px-2 border-b border-slate-800">
                                <div className="font-mono">
                                  <span className="font-bold text-slate-50 block">{node.diskUsage.toFixed(0)}%</span>
                                  <span className="block text-[9px] text-slate-300">{(node.diskReadMbps + node.diskWriteMbps).toFixed(0)} MB/s</span>
                                  <span className="block text-[9px] text-emerald-400 font-bold">Sc: {node.diskScore.toFixed(0)}</span>
                                </div>
                              </td>

                              {/* Network */}
                              <td className="py-3 px-2 border-b border-slate-800">
                                <div className="font-mono">
                                  <span className="font-bold text-slate-50 block">{node.latencyMs.toFixed(0)}ms</span>
                                  <span className="block text-[9px] text-slate-300">{node.downloadMbps.toFixed(0)} Mbps</span>
                                  <span className="block text-[9px] text-emerald-400 font-bold">Sc: {node.networkScore.toFixed(0)}</span>
                                </div>
                              </td>

                              {/* Avg Perf */}
                              <td className="py-3 px-2 text-center border-b border-slate-800">
                                <span className={`inline-block font-mono font-black px-2.5 py-1 rounded text-xs ${
                                  isWinner 
                                    ? 'bg-emerald-500 text-slate-950 shadow-[0_0_8px_rgba(52,211,153,0.4)]' 
                                    : isElim 
                                      ? 'bg-red-950 text-red-400 border border-red-900' 
                                      : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                                }`}>
                                  {isElim ? '—' : `${avgPerf.toFixed(1)}`}
                                </span>
                              </td>

                              {/* Final Score */}
                              <td className="py-3 px-2 text-center border-b border-slate-800">
                                <span className={`inline-block font-mono font-black px-2.5 py-1 rounded text-xs ${
                                  isWinner 
                                    ? 'bg-emerald-500/35 border border-emerald-400 text-emerald-200 shadow-[0_0_8px_rgba(52,211,153,0.2)]' 
                                    : isElim 
                                      ? 'bg-red-950/20 text-red-400 border border-red-900/60' 
                                      : 'bg-slate-800 text-white border border-slate-700'
                                }`}>
                                  {isElim ? '—' : `${node.finalScore.toFixed(1)}`}
                                </span>
                              </td>

                              {/* Selection/Status */}
                              <td className="py-3 px-3 text-right border-b border-slate-800">
                                {isWinner ? (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-bold bg-emerald-500 text-slate-950 border border-emerald-300 shadow-[0_0_8px_rgba(52,211,153,0.3)]">
                                    ✓ SELECTED BEST
                                  </span>
                                ) : isElim ? (
                                  <span className="inline-block text-[9px] text-red-300 font-semibold bg-red-950 border border-red-800/80 px-2 py-0.5 rounded" title={node.eliminationReason}>
                                    ELIMINATED
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[9px] font-semibold bg-slate-800 text-slate-300 border border-slate-700">
                                    EVALUATED
                                  </span>
                                )}
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                {/* AI loading state */}
                {aiLoading && (
                  <div className="flex items-center gap-3 p-4 rounded-xl border" style={{ borderColor: 'rgba(99,179,237,0.2)', background: 'rgba(10,20,50,0.5)' }}>
                    <Loader2 className="w-5 h-5 text-blue-400 animate-spin flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-blue-300">Generating AI Analysis…</p>
                      <p className="text-xs text-slate-500">Querying Groq llama-3.3-70b-versatile for deep insights</p>
                    </div>
                  </div>
                )}

                {aiError && (
                  <div className="flex items-center gap-3 p-4 rounded-xl border border-red-500/20 bg-red-500/5">
                    <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0" />
                    <p className="text-xs text-red-400">AI analysis unavailable — showing rule-based report</p>
                  </div>
                )}

                {aiReport && (
                  <>
                    {aiReport.generatedBy === 'groq' && (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg w-fit text-xs text-emerald-400 border border-emerald-500/20 bg-emerald-500/5">
                        <Sparkles className="w-3 h-3" />
                        Powered by {aiReport.modelUsed} · {aiReport.latencyMs}ms
                      </div>
                    )}

                    {/* Executive Summary */}
                    <div className="rounded-xl p-4 border" style={{ borderColor: 'rgba(52,211,153,0.15)', background: 'rgba(10,20,40,0.6)' }}>
                      <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-2 flex items-center gap-2">
                        <FileText className="w-3 h-3" /> Executive Summary
                      </h3>
                      <p className="text-sm text-slate-300 leading-relaxed">{aiReport.executiveSummary}</p>
                    </div>

                    {/* Selection Rationale */}
                    <div className="rounded-xl p-4 border" style={{ borderColor: 'rgba(99,179,237,0.15)', background: 'rgba(10,20,40,0.6)' }}>
                      <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">Selection Rationale</h3>
                      <p className="text-sm text-slate-300 leading-relaxed">{aiReport.selectionRationale}</p>
                    </div>

                    {/* Grid: Risk + Insights */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div className="rounded-xl p-4 border" style={{ borderColor: 'rgba(245,158,11,0.15)', background: 'rgba(20,15,5,0.5)' }}>
                        <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider mb-2">Risk Assessment</h3>
                        <p className="text-xs text-slate-400 leading-relaxed">{aiReport.riskAssessment}</p>
                      </div>
                      <div className="rounded-xl p-4 border" style={{ borderColor: 'rgba(139,92,246,0.15)', background: 'rgba(15,10,25,0.5)' }}>
                        <h3 className="text-xs font-bold text-purple-400 uppercase tracking-wider mb-2">Performance Insights</h3>
                        <p className="text-xs text-slate-400 leading-relaxed">{aiReport.performanceInsights}</p>
                      </div>
                    </div>

                    {/* Recommendations */}
                    {aiReport.recommendations.length > 0 && (
                      <div className="rounded-xl p-4 border" style={{ borderColor: 'rgba(52,211,153,0.15)', background: 'rgba(10,20,40,0.5)' }}>
                        <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3">AI Recommendations</h3>
                        <div className="space-y-2">
                          {aiReport.recommendations.map((rec, i) => (
                            <div key={i} className="flex items-start gap-2.5">
                              <span className="mt-0.5 w-4 h-4 rounded-full bg-emerald-500/20 flex items-center justify-center flex-shrink-0 text-[9px] text-emerald-400 font-bold">{i + 1}</span>
                              <p className="text-xs text-slate-300 leading-relaxed">{rec}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Comparison Narrative */}
                    {decision.rankedNodes.length > 1 && (
                      <div className="rounded-xl p-4 border" style={{ borderColor: 'rgba(99,179,237,0.12)', background: 'rgba(10,20,40,0.5)' }}>
                        <h3 className="text-xs font-bold text-blue-400 uppercase tracking-wider mb-2">Winner vs. Runner-Up</h3>
                        <p className="text-xs text-slate-400 leading-relaxed">{aiReport.comparisonNarrative}</p>
                      </div>
                    )}
                  </>
                )}

                {/* Positive facts always shown */}
                <div className="rounded-xl p-4 border" style={{ borderColor: 'rgba(52,211,153,0.12)', background: 'rgba(10,20,40,0.5)' }}>
                  <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3">Contributing Factors</h3>
                  <div className="grid gap-1.5">
                    {decision.positiveFacts.map((fact, i) => (
                      <div key={i} className="flex items-center gap-2">
                        <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                        <span className="text-xs text-slate-300">{fact}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Winner score bars */}
                {winner && (
                  <div className="rounded-xl p-4 border" style={{ borderColor: 'rgba(52,211,153,0.12)', background: 'rgba(10,20,40,0.5)' }}>
                    <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-3">Score Breakdown — {winner.deviceName}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-1.5">
                      <ScoreBar value={winner.cpuScore}         label="CPU"         icon={Cpu} />
                      <ScoreBar value={winner.ramScore}         label="RAM"         icon={MemoryStick} />
                      <ScoreBar value={winner.gpuScore}         label="GPU"         icon={Zap} />
                      <ScoreBar value={winner.temperatureScore} label="Temperature" icon={Thermometer} />
                      <ScoreBar value={winner.networkScore}     label="Network"     icon={Wifi} />
                      <ScoreBar value={winner.queueScore}       label="Queue"       icon={ListTodo} />
                      <ScoreBar value={winner.reliabilityScore} label="Reliability" icon={ShieldCheck} />
                      <ScoreBar value={winner.diskScore}        label="Disk"        icon={HardDrive} />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── NODES TAB ── */}
            {activeTab === 'nodes' && (
              <div className="space-y-4">
                {/* Ranked nodes */}
                <div>
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Ranked Candidates</h3>
                  <div className="space-y-2">
                    {decision.rankedNodes.map((node, idx) => (
                      <div
                        key={node.deviceId}
                        className="rounded-xl p-4 border"
                        style={{
                          borderColor: idx === 0 ? 'rgba(52,211,153,0.3)' : 'rgba(52,211,153,0.08)',
                          background:  idx === 0 ? 'rgba(15,60,40,0.2)' : 'rgba(10,15,30,0.5)',
                        }}
                      >
                        <div className="flex items-start justify-between gap-4 mb-3">
                          <div className="flex items-center gap-3">
                            {idx === 0
                              ? <Trophy className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                              : <span className="w-4 h-4 rounded-full bg-slate-700 flex items-center justify-center text-[9px] text-slate-400 font-bold flex-shrink-0">{idx + 1}</span>
                            }
                            <div>
                              <p className={`text-sm font-bold ${idx === 0 ? 'text-emerald-300' : 'text-slate-200'}`}>{node.deviceName}</p>
                              <p className="text-[10px] text-slate-500 font-mono">{node.deviceId.slice(0, 20)}…</p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-xl font-black ${scoreClass(node.finalScore)}`}>{node.finalScore.toFixed(2)}</p>
                            <p className="text-[9px] text-slate-500">/ 100</p>
                          </div>
                        </div>

                        {/* Metric grid */}
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2">
                          {[
                            { label: 'CPU',      value: `${node.cpuUsage.toFixed(0)}%`,     icon: Cpu },
                            { label: 'RAM',      value: `${node.ramUsage.toFixed(0)}%`,     icon: MemoryStick },
                            { label: 'GPU',      value: `${node.gpuUsage.toFixed(0)}%`,     icon: Zap },
                            { label: 'CPU Temp', value: `${node.cpuTemp.toFixed(0)}°C`,     icon: Thermometer },
                            { label: 'Latency',  value: `${node.latencyMs.toFixed(0)}ms`,   icon: Wifi },
                            { label: 'Tasks',    value: `${node.runningTasks}/${node.waitingTasks}`, icon: ListTodo },
                          ].map(({ label, value, icon: Icon }) => (
                            <div key={label} className="rounded-lg p-2 bg-slate-900/50 text-center">
                              <Icon className="w-3 h-3 text-slate-500 mx-auto mb-0.5" />
                              <p className="text-[9px] text-slate-500">{label}</p>
                              <p className="text-xs text-slate-200 font-mono font-medium">{value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Score bars compact */}
                        <div className="mt-3 grid grid-cols-2 gap-1">
                          <ScoreBar value={node.cpuScore}         label="CPU"   icon={Cpu} />
                          <ScoreBar value={node.ramScore}         label="RAM"   icon={MemoryStick} />
                          <ScoreBar value={node.networkScore}     label="Net"   icon={Wifi} />
                          <ScoreBar value={node.diskScore}        label="Disk"  icon={HardDrive} />
                        </div>

                        {idx > 0 && node.eliminationReason && (
                          <p className="mt-2 text-[10px] text-slate-500 flex items-center gap-1">
                            <XCircle className="w-3 h-3 text-amber-500" />
                            {node.eliminationReason}
                          </p>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Eliminated */}
                {decision.eliminatedNodes.length > 0 && (
                  <div>
                    <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider mb-3">Eliminated Nodes</h3>
                    <div className="space-y-2">
                      {decision.eliminatedNodes.map(node => (
                        <div key={node.deviceId} className="rounded-xl p-3 border border-red-500/15 bg-red-500/5 flex items-center gap-3">
                          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-semibold text-red-300">{node.deviceName}</p>
                            <p className="text-xs text-red-400/70">{node.eliminationReason}</p>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── CONFIG TAB ── */}
            {activeTab === 'config' && (
              <div className="space-y-4">
                <div className="rounded-xl p-4 border" style={{ borderColor: 'rgba(52,211,153,0.12)', background: 'rgba(10,15,30,0.6)' }}>
                  <h3 className="text-xs font-bold text-emerald-400 uppercase tracking-wider mb-4">Active Scheduler Weights</h3>
                  <div className="space-y-3">
                    {[
                      { label: 'CPU Availability',       key: 'cpu',         icon: Cpu,        w: decision.weights.cpu },
                      { label: 'RAM Availability',       key: 'ram',         icon: MemoryStick, w: decision.weights.ram },
                      { label: 'GPU Availability',       key: 'gpu',         icon: Zap,        w: decision.weights.gpu },
                      { label: 'Temperature Safety',     key: 'temperature', icon: Thermometer, w: decision.weights.temperature },
                      { label: 'Network Quality',        key: 'network',     icon: Wifi,       w: decision.weights.network },
                      { label: 'Task Queue Depth',       key: 'queue',       icon: ListTodo,   w: decision.weights.queue },
                      { label: 'Historical Reliability', key: 'reliability', icon: ShieldCheck, w: decision.weights.reliability },
                      { label: 'Disk Health & I/O',      key: 'disk',        icon: HardDrive,  w: decision.weights.disk },
                    ].map(({ label, icon: Icon, w }) => (
                      <div key={label} className="flex items-center gap-3">
                        <Icon className="w-3.5 h-3.5 text-slate-500 flex-shrink-0" />
                        <span className="text-xs text-slate-400 w-40 flex-shrink-0">{label}</span>
                        <div className="flex-1 bg-slate-800 rounded-full h-2 overflow-hidden">
                          <div className="h-full rounded-full bg-emerald-500/60" style={{ width: `${w * 100}%` }} />
                        </div>
                        <span className="text-xs font-mono font-bold text-emerald-400 w-10 text-right">{(w * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-3 pt-3 border-t border-slate-800 flex items-center justify-between">
                    <span className="text-xs text-slate-500">Total weight</span>
                    <span className="text-xs font-mono font-bold text-emerald-400">
                      {(Object.values(decision.weights).reduce((a, b) => a + b, 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {aiReport?.technicianNotes && (
                  <div className="rounded-xl p-4 border border-slate-700/30 bg-slate-900/30">
                    <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-2">Technician Notes</h3>
                    <p className="text-xs text-slate-500 leading-relaxed">{aiReport.technicianNotes}</p>
                  </div>
                )}

                <div className="rounded-xl p-4 border border-slate-700/20 bg-slate-900/20">
                  <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider mb-3">Decision Metadata</h3>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Decision ID',    value: String(decision.timestamp) },
                      { label: 'Nodes Scored',   value: String(decision.totalConsidered) },
                      { label: 'Nodes Eliminated', value: String(decision.eliminatedNodes.length) },
                      { label: 'Tiebreaker',     value: decision.tiebroken ? (decision.tiebreakMethod ?? 'Yes') : 'None' },
                      { label: 'Confidence',     value: `${decision.confidence}%` },
                      { label: 'Score Margin',   value: decision.rankedNodes.length > 1 ? (decision.rankedNodes[0].finalScore - decision.rankedNodes[1].finalScore).toFixed(4) : 'N/A' },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-lg p-2.5 bg-slate-900/50">
                        <p className="text-[10px] text-slate-500 mb-0.5">{label}</p>
                        <p className="text-xs font-mono text-slate-300">{value}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
