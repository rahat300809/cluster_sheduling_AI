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
import { buildFallbackAnalysis } from '@/lib/groqAnalysis';
import { useAppStore } from '@/store/appStore';
import { runScheduler } from '@/lib/scheduler';

// ─── Props ────────────────────────────────────────────────────────────────────

interface AiReportModalProps {
  decision: SchedulerDecision;
  jobName?: string;
  jobId?: string;
  onClose: () => void;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 80) return '#06b6d4'; // Cyan
  if (score >= 60) return '#a78bfa'; // Purple/Violet
  if (score >= 40) return '#f59e0b'; // Amber
  return '#f43f5e'; // Rose
}
function scoreClass(score: number) {
  if (score >= 80) return 'text-cyan-400';
  if (score >= 60) return 'text-purple-300';
  if (score >= 40) return 'text-amber-400';
  return 'text-rose-400';
}
function scoreBg(score: number) {
  if (score >= 80) return 'bg-cyan-500/10 border-cyan-500/20';
  if (score >= 60) return 'bg-purple-500/10 border-purple-500/20';
  if (score >= 40) return 'bg-amber-500/10 border-amber-500/20';
  return 'bg-rose-500/10 border-rose-500/20';
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
  const filename  = `ClusterOS_Report_${jobName.replace(/\s+/g, '_')}_${format(new Date(decision.timestamp), 'yyyyMMdd_HHmmss')}.pdf`;

  const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4' });
  const W   = pdf.internal.pageSize.getWidth();
  const H   = pdf.internal.pageSize.getHeight();

  // ── Palette (Clean High-Contrast White Background) ─────────────────────────
  const C = {
    bg:          [255, 255, 255] as [number,number,number], // white
    surface:     [248, 250, 252] as [number,number,number], // slate-50
    cardBorder:  [226, 232, 240] as [number,number,number], // slate-200
    textMain:    [15, 23, 42]    as [number,number,number], // slate-900
    textSub:     [71, 85, 105]   as [number,number,number], // slate-600
    textMuted:   [148, 163, 184] as [number,number,number], // slate-400
    accent:      [124, 58, 237]  as [number,number,number], // violet-600 (was emerald)
    accentLight: [237, 233, 254] as [number,number,number], // violet-100
    blue:        [8, 145, 178]   as [number,number,number], // cyan-600
    blueLight:   [207, 250, 254] as [number,number,number], // cyan-100
    red:         [225, 29, 72]   as [number,number,number], // rose-600
    redLight:    [255, 228, 230] as [number,number,number], // rose-100
    amber:       [180, 83, 9]    as [number,number,number], // amber-700
    rowA:        [255, 255, 255] as [number,number,number],
    rowB:        [248, 250, 252] as [number,number,number],
    border:      [226, 232, 240] as [number,number,number],
  };

  let pageNum = 1;

  function addPageBg() {
    pdf.setFillColor(...C.bg);
    pdf.rect(0, 0, W, H, 'F');
    // Elegant thin line at the top
    pdf.setFillColor(...C.textMain);
    pdf.rect(0, 0, W, 1.5, 'F');
  }

  function addFooter() {
    pdf.setFontSize(7);
    pdf.setTextColor(...C.textSub);
    pdf.text(
      `ClusterOS Scheduler Dispatch Report  ·  Confidential  ·  Generated ${timestamp}  ·  Page ${pageNum}`,
      W / 2, H - 6, { align: 'center' }
    );
    pageNum++;
  }

  function addSectionHeader(label: string, y: number): number {
    pdf.setFillColor(...C.surface);
    pdf.setDrawColor(...C.border);
    pdf.setLineWidth(0.2);
    pdf.roundedRect(10, y, W - 20, 7, 0.5, 0.5, 'FD');
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...C.textMain);
    pdf.text(`▶  ${label.toUpperCase()}`, 14, y + 4.8);
    return y + 10;
  }

  // ════════════════════════════════════════════════════════════
  // PAGE 1 — Header + Summary Cards + Rationale & Overview
  // ════════════════════════════════════════════════════════════
  addPageBg();

  // Logo / Title
  pdf.setFontSize(14);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...C.textMain);
  pdf.text('ClusterOS', 12, 12);
  pdf.setFontSize(9);
  pdf.setTextColor(...C.accent);
  pdf.text('Intelligent Scheduler — Performance & Dispatch Report', 42, 12);

  // Timestamp right-aligned
  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...C.textSub);
  pdf.text(timestamp, W - 12, 12, { align: 'right' });

  // Job name sub-line
  pdf.setFontSize(8);
  pdf.setTextColor(...C.textSub);
  pdf.text(`Job: ${jobName}   ·   Scheduler Run ID: ${decision.timestamp}`, 12, 17);

  let y = 26;

  // ── SUMMARY CARDS ────────────────────────────────────────────────────────
  const cardW  = (W - 30) / 4;
  const cards = [
    { label: 'SELECTED PC', value: winner?.deviceName ?? '—', sub: `Score: ${decision.finalScore.toFixed(2)}/100` },
    { label: 'CONFIDENCE',   value: `${decision.confidence}%`, sub: decision.tiebroken ? `Tiebreaker: ${decision.tiebreakMethod}` : 'Direct selection' },
    { label: 'NODES EVALUATED', value: `${decision.totalConsidered + decision.eliminatedNodes.length}`, sub: `${decision.eliminatedNodes.length} eliminated` },
    { label: 'EST. COMPLETION', value: `~${decision.expectedCompletionMinutes ?? 5} min`, sub: `${winner?.runningTasks ?? 0} tasks running` },
  ];

  cards.forEach((card, i) => {
    const cx = 10 + i * (cardW + 2.5);
    pdf.setFillColor(...C.surface);
    pdf.setDrawColor(...C.border);
    pdf.setLineWidth(0.3);
    pdf.roundedRect(cx, y, cardW, 20, 1, 1, 'FD');

    pdf.setFontSize(6.5);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...C.textSub);
    pdf.text(card.label, cx + cardW / 2, y + 5.5, { align: 'center' });

    pdf.setFontSize(11);
    pdf.setFont('helvetica', 'bold');
    pdf.setTextColor(...C.accent);
    const valStr = card.value.length > 14 ? card.value.slice(0, 13) + '…' : card.value;
    pdf.text(valStr, cx + cardW / 2, y + 13, { align: 'center' });

    pdf.setFontSize(6.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...C.textSub);
    pdf.text(card.sub, cx + cardW / 2, y + 18, { align: 'center' });
  });
  y += 24;

  // ── ANALYSIS NARRATIVE SECTIONS ──────────────────────────────────────────
  if (aiReport) {
    y = addSectionHeader('Executive Summary', y);
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...C.textMain);
    const summaryLines = pdf.splitTextToSize(aiReport.executiveSummary, W - 24);
    pdf.text(summaryLines, 14, y);
    y += summaryLines.length * 4.5 + 4;

    y = addSectionHeader('Selection Rationale & Mathematical Reasoning', y);
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...C.textMain);
    const rationaleLines = pdf.splitTextToSize(aiReport.selectionRationale, W - 24);
    pdf.text(rationaleLines, 14, y);
    y += rationaleLines.length * 4.5 + 4;

    y = addSectionHeader('Risk Assessment', y);
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...C.textMain);
    const riskLines = pdf.splitTextToSize(aiReport.riskAssessment, W - 24);
    pdf.text(riskLines, 14, y);
    y += riskLines.length * 4.5 + 4;
  } else {
    y = addSectionHeader('Routing Decision & Selection Reasoning', y);
    pdf.setFontSize(8.5);
    pdf.setFont('helvetica', 'normal');
    pdf.setTextColor(...C.textMain);
    const routingLines = pdf.splitTextToSize(decision.routingReason, W - 24);
    pdf.text(routingLines, 14, y);
    y += routingLines.length * 4.5 + 4;
  }

  // ── POSITIVE CONTRIBUTING FACTORS ────────────────────────────────────────
  y = addSectionHeader('Contributing Performance Factors (Winner Selection)', y);
  decision.positiveFacts.forEach((fact) => {
    pdf.setFontSize(8);
    pdf.setTextColor(...C.accent);
    pdf.text('✓', 15, y);
    pdf.setTextColor(...C.textMain);
    pdf.text(fact, 21, y);
    y += 5;
  });
  y += 3;

  // ── RECOMMENDATIONS ──────────────────────────────────────────────────────
  if (aiReport?.recommendations?.length) {
    if (y > H - 55) { pdf.addPage(); addPageBg(); y = 26; }
    y = addSectionHeader('Actionable System Recommendations', y);
    aiReport.recommendations.forEach((rec, i) => {
      pdf.setFontSize(8);
      pdf.setTextColor(...C.amber);
      pdf.text(`${i + 1}.`, 15, y);
      pdf.setTextColor(...C.textMain);
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
  pdf.setTextColor(...C.textMain);
  pdf.text('PC Performance Comparison Matrix', 12, 14);
  pdf.setFontSize(7.5);
  pdf.setFont('helvetica', 'normal');
  pdf.setTextColor(...C.textSub);
  pdf.text(`Scheduler Weights: CPU ${(decision.weights.cpu*100).toFixed(0)}%  RAM ${(decision.weights.ram*100).toFixed(0)}%  GPU ${(decision.weights.gpu*100).toFixed(0)}%  Temp ${(decision.weights.temperature*100).toFixed(0)}%  Net ${(decision.weights.network*100).toFixed(0)}%  Queue ${(decision.weights.queue*100).toFixed(0)}%  Reliability ${(decision.weights.reliability*100).toFixed(0)}%  Disk ${(decision.weights.disk*100).toFixed(0)}%`, 12, 20);

  // All scored nodes table
  const allNodes = [...decision.rankedNodes, ...decision.eliminatedNodes];

  autoTable(pdf, {
    startY: 25,
    head: [[
      'Rank', 'Node', 'CPU%', 'RAM%', 'GPU%',
      'Ping', 'Tasks', 'Avg Perf', 'Score', 'Decision & Reason'
    ]],
    body: allNodes.map((n, i) => {
      const rank = n.eliminated ? 'ELIM' : `#${decision.rankedNodes.findIndex(r => r.deviceId === n.deviceId) + 1}`;
      const reason = n.eliminated
        ? (n.eliminationReason ?? 'Node is offline')
        : (n.deviceId === decision.selectedDeviceId
            ? 'SELECTED WINNER ✓'
            : (n.eliminationReason ?? 'Lower Score')
          );
      return [
        rank,
        (n.deviceName || n.deviceId.slice(0, 8)).slice(0, 16),
        `${(n.cpuUsage ?? 0).toFixed(0)}%`,
        `${(n.ramUsage ?? 0).toFixed(0)}%`,
        `${(n.gpuUsage ?? 0).toFixed(0)}%`,
        `${(n.latencyMs ?? 0).toFixed(0)}ms`,
        `${n.runningTasks ?? 0}/${n.waitingTasks ?? 0}`,
        n.eliminated ? '—' : (n.averagePerformance ?? 0).toFixed(1),
        n.eliminated ? '—' : (n.finalScore ?? 0).toFixed(1),
        reason
      ];
    }),
    theme: 'plain',
    styles: {
      fontSize: 6.5,
      cellPadding: { top: 2.5, right: 2, bottom: 2.5, left: 2 },
      textColor: C.textMain,
      lineColor: C.border,
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: C.surface,
      textColor: C.textMain,
      fontStyle: 'bold',
      fontSize: 6.5,
    },
    columnStyles: {
      0: { cellWidth: 10, halign: 'center' },
      1: { cellWidth: 20 },
      2: { cellWidth: 12, halign: 'center' },
      3: { cellWidth: 12, halign: 'center' },
      4: { cellWidth: 12, halign: 'center' },
      5: { cellWidth: 12, halign: 'center' },
      6: { cellWidth: 12, halign: 'center' },
      7: { cellWidth: 15, halign: 'center', fontStyle: 'bold', textColor: C.blue },
      8: { cellWidth: 15, halign: 'center', fontStyle: 'bold', textColor: C.accent },
      9: { cellWidth: 70 },
    },
    alternateRowStyles: { fillColor: C.rowB },
    bodyStyles: { fillColor: C.rowA },
    didParseCell: (data: any) => {
      const rowNode = allNodes[data.row.index];
      if (rowNode?.deviceId === decision.selectedDeviceId) {
        data.cell.styles.fillColor = C.accentLight;
        data.cell.styles.textColor = C.accent;
        data.cell.styles.fontStyle = 'bold';
      }
      if (rowNode?.eliminated) {
        data.cell.styles.textColor = C.red;
        data.cell.styles.fillColor = C.redLight;
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
    pdf.setTextColor(...C.textMain);
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
        cellPadding: { top: 2.2, right: 2, bottom: 2.2, left: 2 },
        textColor: C.textMain,
        lineColor: C.border,
        lineWidth: 0.25,
      },
      headStyles: {
        fillColor: C.surface,
        textColor: C.textMain,
        fontStyle: 'bold',
        fontSize: 6.5,
      },
      alternateRowStyles: { fillColor: C.rowB },
      bodyStyles: { fillColor: C.rowA },
      didParseCell: (data: any) => {
        if (decision.rankedNodes[data.row.index]?.deviceId === decision.selectedDeviceId) {
          data.cell.styles.fillColor = C.accentLight;
          data.cell.styles.textColor = C.accent;
          data.cell.styles.fontStyle = 'bold';
        }
        if (data.column.index === 10) {
          data.cell.styles.fontStyle = 'bold';
        }
      },
      margin: { left: 10, right: 10 },
    });
  }

  addFooter();

  // ════════════════════════════════════════════════════════════
  // PAGE 3 — Eliminated Nodes + System Weight Configuration
  // ════════════════════════════════════════════════════════════
  pdf.addPage();
  addPageBg();

  pdf.setFontSize(12);
  pdf.setFont('helvetica', 'bold');
  pdf.setTextColor(...C.textMain);
  pdf.text('Eliminated Nodes & System Weight Configuration', 12, 14);

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
        textColor: C.red,
        lineColor: C.border,
        lineWidth: 0.25,
      },
      headStyles: {
        fillColor: C.redLight,
        textColor: C.red,
        fontStyle: 'bold',
        fontSize: 7,
      },
      bodyStyles: { fillColor: C.rowA },
      alternateRowStyles: { fillColor: C.rowB },
      margin: { left: 10, right: 10 },
    });
    y3 = ((pdf as any).lastAutoTable?.finalY as number | undefined) != null ? (pdf as any).lastAutoTable.finalY + 8 : y3 + 20;
  } else {
    pdf.setFontSize(8);
    pdf.setFont('helvetica', 'italic');
    pdf.setTextColor(...C.textSub);
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
      textColor: C.textMain,
      lineColor: C.border,
      lineWidth: 0.25,
    },
    headStyles: {
      fillColor: C.surface,
      textColor: C.textMain,
      fontStyle: 'bold',
      fontSize: 7.5,
    },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 42 },
      1: { halign: 'center', cellWidth: 18, textColor: C.accent, fontStyle: 'bold' },
      2: { textColor: C.textSub },
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
      pdf.setTextColor(...C.textMain);
      const insightLines = pdf.splitTextToSize(aiReport.performanceInsights, W - 24);
      pdf.text(insightLines, 14, y3);
      y3 += insightLines.length * 4.5 + 4;
    }
    if (aiReport.comparisonNarrative && decision.rankedNodes.length > 1) {
      y3 = addSectionHeader('Node Comparison Narrative', y3);
      pdf.setFontSize(8.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...C.textMain);
      const compLines = pdf.splitTextToSize(aiReport.comparisonNarrative, W - 24);
      pdf.text(compLines, 14, y3);
      y3 += compLines.length * 4.5 + 4;
    }
    if (aiReport.technicianNotes) {
      y3 = addSectionHeader('Technician Notes', y3);
      pdf.setFontSize(8.5);
      pdf.setFont('helvetica', 'normal');
      pdf.setTextColor(...C.textSub);
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
  const { devices, metricsMap } = useAppStore();

  const decision: SchedulerDecision = (() => {
    const rawDecision: SchedulerDecision = {
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

    if (rawDecision.rankedNodes.length === 0 && rawDecision.eliminatedNodes.length === 0 && devices.length > 0) {
      // Reconstruct dynamic scheduler details using the weights & target of this decision
      const reconstructed = runScheduler(
        devices,
        metricsMap,
        undefined,
        rawDecision.weights
      );

      if (reconstructed) {
        const targetId = rawDecision.selectedDeviceId || reconstructed.selectedDeviceId;
        const selectedNode = reconstructed.rankedNodes.find(n => n.deviceId === targetId) 
          || reconstructed.eliminatedNodes.find(n => n.deviceId === targetId);

        let newRanked = [...reconstructed.rankedNodes];
        if (selectedNode && !selectedNode.eliminated) {
          newRanked = [
            selectedNode,
            ...reconstructed.rankedNodes.filter(n => n.deviceId !== targetId)
          ];
        }

        return {
          ...reconstructed,
          selectedDeviceId: targetId,
          selectedDeviceName: selectedNode?.deviceName ?? rawDecision.selectedDeviceName,
          finalScore: selectedNode?.finalScore ?? 0,
          rankedNodes: newRanked,
          timestamp: rawDecision.timestamp,
        };
      } else {
        // Fallback populating from current devices as eliminated (offline)
        rawDecision.eliminatedNodes = devices.map(d => {
          const m = metricsMap[d.deviceId];
          return {
            deviceId: d.deviceId,
            deviceName: d.name || d.machineName,
            cpuUsage: m?.cpu?.total ?? 0,
            ramUsage: m?.ram?.usedPercent ?? 0,
            gpuUsage: m?.gpu?.usagePercent ?? 0,
            cpuTemp: m?.temperatures?.cpu ?? 0,
            gpuTemp: m?.temperatures?.gpu ?? 0,
            latencyMs: m?.network?.latencyMs ?? 0,
            runningTasks: m?.runningTasks ?? 0,
            waitingTasks: m?.waitingTasks ?? 0,
            diskUsage: m?.disk?.usedPercent ?? 0,
            successRate: m?.successRate ?? 80,
            batteryPercent: m?.batteryPercent ?? null,
            powerPluggedIn: m?.powerPluggedIn ?? null,
            uptimeHours: (m?.uptimeSeconds ?? 0) / 3600,
            diskReadMbps: m?.disk?.readMbps ?? 0,
            diskWriteMbps: m?.disk?.writeMbps ?? 0,
            downloadMbps: m?.network?.downloadMbps ?? 0,
            uploadMbps: m?.network?.uploadMbps ?? 0,
            cpuScore: 0, ramScore: 0, gpuScore: 0, temperatureScore: 0, networkScore: 0, queueScore: 0, reliabilityScore: 0, diskScore: 0, finalScore: 0, averagePerformance: 0,
            status: m?.status ?? 'offline', healthStatus: m?.healthStatus ?? 'critical', eliminated: true, eliminationReason: 'Node is offline'
          };
        });
      }
    }
    return rawDecision;
  })();

  // Instantly generate mathematical rule-based analysis report locally without Groq API calls
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

    const mappedScores = decision.rankedNodes.map(n => ({
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
    }));

    const decisionForAI = {
      ...decision,
      decisionId:    String(decision.timestamp),
      selectedNode:  mappedScores[0] || null,
      allScores:     mappedScores,
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
  }, [decision.timestamp, decision.selectedDeviceId]);

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
          initial={{ scale: 0.95, opacity: 0, y: 15 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 8 }}
          transition={{ type: 'spring', stiffness: 260, damping: 26 }}
          className="relative w-full max-w-[96vw] h-[94vh] flex flex-col overflow-hidden rounded-2xl border cyber-glass font-outfit"
          style={{ background: 'linear-gradient(135deg,#020512 0%,#080c20 100%)', borderColor: 'rgba(139,92,246,0.3)' }}
        >
          {/* Header */}
          <div className="flex items-center justify-between px-8 py-5 border-b" style={{ borderColor: 'rgba(139,92,246,0.2)', background: 'rgba(7,10,30,0.85)' }}>
            <div className="flex items-center gap-4">
              <div className="w-10 h-10 rounded-xl bg-violet-600/20 flex items-center justify-center border border-violet-500/30 glow-violet">
                <Sparkles className="w-5 h-5 text-violet-400" />
              </div>
              <div>
                <h2 className="font-space font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-indigo-200 to-cyan-300 text-lg uppercase tracking-wider">AI Workload Dispatch Report</h2>
                <p className="text-xs text-slate-400 font-medium font-outfit">{jobName} · {format(new Date(decision.timestamp), 'MMM d, yyyy HH:mm:ss')}</p>
              </div>
            </div>
            <div className="flex items-center gap-3">
              {/* Export CSV */}
              <button
                onClick={() => exportToCSV(decision, jobName)}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-slate-300 bg-slate-900/80 hover:bg-slate-800 transition-all border border-slate-800 hover:border-slate-700 cursor-pointer"
              >
                <FileText className="w-4 h-4 text-violet-400" />
                CSV Export
              </button>
              {/* Export PDF */}
              <button
                onClick={handlePDFExport}
                disabled={pdfLoading}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-xs font-bold text-white transition-all border cursor-pointer glow-cyan"
                style={{ background: pdfLoading ? 'rgba(6,182,212,0.2)' : 'linear-gradient(135deg, rgba(139,92,246,0.3) 0%, rgba(6,182,212,0.3) 100%)', borderColor: 'rgba(6,182,212,0.5)' }}
              >
                {pdfLoading ? <Loader2 className="w-4 h-4 animate-spin text-cyan-300" /> : <Download className="w-4 h-4 text-cyan-300" />}
                {pdfLoading ? 'Exporting…' : 'Download PDF'}
              </button>
              <button onClick={onClose} className="w-9 h-9 rounded-xl bg-slate-900/60 hover:bg-slate-850 flex items-center justify-center border border-slate-800 hover:border-slate-700 transition-all cursor-pointer">
                <X className="w-4 h-4 text-slate-400 hover:text-white" />
              </button>
            </div>
          </div>

          {/* Tabs */}
          <div className="flex border-b px-8" style={{ borderColor: 'rgba(139,92,246,0.1)' }}>
            {([
              { id: 'overview', label: 'AI Overview', icon: Sparkles },
              { id: 'nodes',    label: 'Node Comparison Matrix', icon: BarChart2 },
              { id: 'config',   label: 'Weights & Metrics Configuration', icon: Activity },
            ] as const).map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3.5 text-xs font-bold border-b-2 transition-all cursor-pointer ${
                  activeTab === tab.id
                    ? 'text-cyan-400 border-cyan-400 font-space tracking-wider'
                    : 'text-slate-500 border-transparent hover:text-slate-300'
                }`}
              >
                <tab.icon className="w-3.5 h-3.5" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto p-8 space-y-6">

            {/* ── Summary Cards (always visible) ── */}
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {[
                { label: 'Selected Node',   value: winner?.deviceName ?? '—',               icon: Trophy,  textColor: 'text-cyan-400', borderGlow: 'glow-cyan', bg: 'bg-cyan-950/20 border-cyan-500/20' },
                { label: 'Final Score',     value: `${decision.finalScore.toFixed(2)}/100`, icon: BarChart2, textColor: 'text-violet-400', borderGlow: 'glow-violet', bg: 'bg-violet-950/20 border-violet-500/20' },
                { label: 'Confidence',      value: `${decision.confidence}%`,               icon: ShieldCheck, textColor: 'text-indigo-400', borderGlow: '', bg: 'bg-indigo-950/25 border-indigo-500/20' },
                { label: 'Est. Completion', value: `~${decision.expectedCompletionMinutes ?? 5} min`, icon: Clock, textColor: 'text-amber-400', borderGlow: '', bg: 'bg-amber-950/15 border-amber-500/20' },
              ].map((card) => (
                <div key={card.label} className={`rounded-2xl p-5 border ${card.bg} ${card.borderGlow} transition-all duration-300 hover:scale-[1.01]`}>
                  <div className="flex items-center gap-2 mb-2">
                    <card.icon className={`w-4 h-4 ${card.textColor}`} />
                    <span className="text-[10px] text-slate-400 font-extrabold uppercase tracking-widest">{card.label}</span>
                  </div>
                  <p className={`text-2xl font-black font-space tracking-tight ${card.textColor} truncate`}>{card.value}</p>
                </div>
              ))}
            </div>

            {/* ── OVERVIEW TAB ── */}
            {activeTab === 'overview' && (
              <div className="space-y-4">
                {/* AI Overview Performance Table */}
                <div className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-6 overflow-hidden shadow-2xl backdrop-blur-md">
                  <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-5">
                    <div>
                      <h3 className="text-sm font-black text-transparent bg-clip-text bg-gradient-to-r from-violet-400 to-cyan-300 uppercase tracking-wider flex items-center gap-2 font-space">
                        <BarChart2 className="w-5 h-5 text-violet-400" /> PC Performance Comparison Matrix
                      </h3>
                      <p className="text-xs text-slate-400 mt-1 font-medium font-outfit">Real-time metrics, normalized factor scores, arithmetic average performance (equal weights), and weighted scheduler composite final score.</p>
                    </div>
                    <div className="text-[10px] text-cyan-300 bg-slate-950/80 px-4 py-2 rounded-xl border border-violet-500/20 font-jetbrains self-start md:self-auto">
                      Formula: Avg Score = (CPU + RAM + GPU + Temp + Net + Queue + Rel. + Disk) / 8
                    </div>
                  </div>

                  <div className="overflow-x-auto -mx-6 px-6">
                    <table className="w-full text-left text-xs border-collapse min-w-[850px] font-outfit">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-300 text-[10px] font-extrabold uppercase tracking-widest bg-slate-950/50">
                          <th className="py-4 px-4 font-space">PC Node</th>
                          <th className="py-4 px-3 font-space">CPU</th>
                          <th className="py-4 px-3 font-space">RAM</th>
                          <th className="py-4 px-3 font-space">GPU</th>
                          <th className="py-4 px-3 font-space">SSD/Disk</th>
                          <th className="py-4 px-3 font-space">Network</th>
                          <th className="py-4 px-3 text-center font-space">Avg Perf</th>
                          <th className="py-4 px-3 text-center font-space">Final Score</th>
                          <th className="py-4 px-4 text-right font-space">Selection</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60 bg-slate-900/20">
                        {[...decision.rankedNodes, ...decision.eliminatedNodes].map((node) => {
                          const isWinner = node.deviceId === decision.selectedDeviceId;
                          const isElim = node.eliminated;
                          const avgPerf = node.averagePerformance ?? 0;
                          
                          return (
                            <tr 
                              key={node.deviceId}
                              className={`transition-all duration-200 hover:bg-slate-850/40 ${
                                isWinner 
                                  ? 'bg-violet-950/20 text-white font-semibold border-l-2 border-violet-500' 
                                  : isElim 
                                    ? 'bg-rose-950/5 text-slate-400' 
                                    : 'text-slate-200'
                              }`}
                            >
                              {/* PC Node */}
                              <td className="py-4 px-4 border-b border-slate-850">
                                <div className="flex items-center gap-3">
                                  {isWinner ? (
                                    <div className="w-6 h-6 rounded-lg bg-violet-500/25 flex items-center justify-center border border-violet-400/50 glow-violet flex-shrink-0">
                                      <Trophy className="w-3.5 h-3.5 text-violet-300" />
                                    </div>
                                  ) : isElim ? (
                                    <div className="w-6 h-6 rounded-lg bg-rose-500/20 flex items-center justify-center border border-rose-500/30 flex-shrink-0">
                                      <XCircle className="w-3.5 h-3.5 text-rose-400" />
                                    </div>
                                  ) : (
                                    <div className="w-6 h-6 rounded-lg bg-slate-800 flex items-center justify-center text-[10px] font-bold text-slate-400 border border-slate-700 flex-shrink-0">
                                      PC
                                    </div>
                                  )}
                                  <div>
                                    <div className="flex items-center gap-2">
                                      <span className="font-bold text-sm block text-slate-100">{node.deviceName}</span>
                                      {isWinner && (
                                        <span className="bg-violet-500/20 text-violet-400 text-[8px] font-extrabold px-2 py-0.5 rounded border border-violet-500/30 uppercase tracking-widest">Winner</span>
                                      )}
                                    </div>
                                    <span className="text-[9px] text-slate-500 font-mono tracking-tighter truncate max-w-[140px] block mt-0.5">{node.deviceId}</span>
                                    {!isWinner && node.eliminationReason && (
                                      <span className={`block text-[9px] mt-1 font-medium ${isElim ? 'text-rose-400 font-bold' : 'text-amber-400'}`} style={{ maxWidth: '220px' }}>
                                        {isElim ? '✗ Eliminated: ' : '⚠ Rejected: '}{node.eliminationReason}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </td>

                              {/* CPU */}
                              <td className="py-4 px-3 border-b border-slate-850">
                                <div className="font-jetbrains">
                                  <span className="font-bold text-slate-100 text-xs block">{node.cpuUsage.toFixed(0)}%</span>
                                  <span className="block text-[9px] text-slate-400 mt-0.5">{node.cpuTemp.toFixed(0)}°C</span>
                                  <span className={`block text-[9px] font-bold ${scoreClass(node.cpuScore)}`}>Sc: {node.cpuScore.toFixed(0)}</span>
                                </div>
                              </td>

                              {/* RAM */}
                              <td className="py-4 px-3 border-b border-slate-850">
                                <div className="font-jetbrains">
                                  <span className="font-bold text-slate-100 text-xs block">{node.ramUsage.toFixed(0)}%</span>
                                  <span className="block text-[9px] text-slate-400 mt-0.5">Uptime: {node.uptimeHours.toFixed(1)}h</span>
                                  <span className={`block text-[9px] font-bold ${scoreClass(node.ramScore)}`}>Sc: {node.ramScore.toFixed(0)}</span>
                                </div>
                              </td>

                              {/* GPU */}
                              <td className="py-4 px-3 border-b border-slate-850">
                                <div className="font-jetbrains">
                                  <span className="font-bold text-slate-100 text-xs block">{node.gpuUsage.toFixed(0)}%</span>
                                  <span className="block text-[9px] text-slate-400 mt-0.5">{node.gpuTemp.toFixed(0)}°C</span>
                                  <span className={`block text-[9px] font-bold ${scoreClass(node.gpuScore)}`}>Sc: {node.gpuScore.toFixed(0)}</span>
                                </div>
                              </td>

                              {/* SSD/Disk */}
                              <td className="py-4 px-3 border-b border-slate-850">
                                <div className="font-jetbrains">
                                  <span className="font-bold text-slate-100 text-xs block">{node.diskUsage.toFixed(0)}%</span>
                                  <span className="block text-[9px] text-slate-400 mt-0.5">{(node.diskReadMbps + node.diskWriteMbps).toFixed(0)} MB/s</span>
                                  <span className={`block text-[9px] font-bold ${scoreClass(node.diskScore)}`}>Sc: {node.diskScore.toFixed(0)}</span>
                                </div>
                              </td>

                              {/* Network */}
                              <td className="py-4 px-3 border-b border-slate-850">
                                <div className="font-jetbrains">
                                  <span className="font-bold text-slate-100 text-xs block">{node.latencyMs.toFixed(0)}ms</span>
                                  <span className="block text-[9px] text-slate-400 mt-0.5">{node.downloadMbps.toFixed(0)} Mbps</span>
                                  <span className={`block text-[9px] font-bold ${scoreClass(node.networkScore)}`}>Sc: {node.networkScore.toFixed(0)}</span>
                                </div>
                              </td>

                              {/* Avg Perf */}
                              <td className="py-4 px-3 text-center border-b border-slate-850">
                                <span className={`inline-block font-jetbrains font-black px-3 py-1 rounded-lg text-xs ${
                                  isWinner 
                                    ? 'bg-violet-500 text-slate-950 shadow-[0_0_12px_rgba(139,92,246,0.5)]' 
                                    : isElim 
                                      ? 'bg-rose-950/40 text-rose-400 border border-rose-900/60' 
                                      : 'bg-cyan-950/40 text-cyan-300 border border-cyan-900/30'
                                }`}>
                                  {isElim ? '—' : `${avgPerf.toFixed(1)}`}
                                </span>
                              </td>

                              {/* Final Score */}
                              <td className="py-4 px-3 text-center border-b border-slate-850">
                                <span className={`inline-block font-jetbrains font-black px-3 py-1 rounded-lg text-xs ${
                                  isWinner 
                                    ? 'bg-cyan-500 text-slate-950 shadow-[0_0_12px_rgba(6,182,212,0.5)] border border-cyan-400' 
                                    : isElim 
                                      ? 'bg-rose-950/20 text-rose-400 border border-rose-900/30' 
                                      : 'bg-slate-800 text-white border border-slate-700'
                                }`}>
                                  {isElim ? '—' : `${node.finalScore.toFixed(1)}`}
                                </span>
                              </td>

                              {/* Selection/Status */}
                              <td className="py-4 px-4 text-right border-b border-slate-850 font-space">
                                {isWinner ? (
                                  <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-extrabold bg-violet-600 text-white border border-violet-400/50 shadow-[0_0_10px_rgba(139,92,246,0.3)]">
                                    ✓ SELECTED BEST
                                  </span>
                                ) : isElim ? (
                                  <span className="inline-block text-[10px] text-rose-400 font-bold bg-rose-950/30 border border-rose-900/30 px-3 py-1 rounded-xl" title={node.eliminationReason}>
                                    ELIMINATED
                                  </span>
                                ) : (
                                  <span className="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-[10px] font-bold bg-slate-800/40 text-slate-400 border border-slate-700">
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
                  <div className="flex items-center gap-3 p-5 rounded-2xl border" style={{ borderColor: 'rgba(6,182,212,0.2)', background: 'rgba(6,182,212,0.05)' }}>
                    <Loader2 className="w-5 h-5 text-cyan-400 animate-spin flex-shrink-0" />
                    <div>
                      <p className="text-sm font-bold text-cyan-300">Generating AI Analysis…</p>
                      <p className="text-xs text-slate-500">Querying Groq llama-3.3-70b-versatile for deep insights</p>
                    </div>
                  </div>
                )}

                {aiError && (
                  <div className="flex items-center gap-3 p-5 rounded-2xl border border-rose-500/20 bg-rose-500/5">
                    <AlertTriangle className="w-4 h-4 text-rose-400 flex-shrink-0" />
                    <p className="text-xs text-rose-400">AI analysis unavailable — showing rule-based report</p>
                  </div>
                )}

                {aiReport && (
                  <>
                    {aiReport.generatedBy === 'groq' && (
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg w-fit text-xs text-cyan-400 border border-cyan-500/20 bg-cyan-500/5 font-mono">
                        <Sparkles className="w-3 h-3 text-cyan-400" />
                        Powered by {aiReport.modelUsed} · {aiReport.latencyMs}ms
                      </div>
                    )}

                    {/* Executive Summary */}
                    <div className="rounded-2xl p-5 border border-violet-500/20 bg-violet-950/5">
                      <h3 className="text-xs font-extrabold text-violet-400 uppercase tracking-widest mb-3 flex items-center gap-2 font-space">
                        <FileText className="w-4 h-4 text-violet-400" /> Executive Summary
                      </h3>
                      <p className="text-sm text-slate-300 leading-relaxed font-outfit font-medium">{aiReport.executiveSummary}</p>
                    </div>

                    {/* Selection Rationale */}
                    <div className="rounded-2xl p-5 border border-cyan-500/20 bg-cyan-950/5">
                      <h3 className="text-xs font-extrabold text-cyan-400 uppercase tracking-widest mb-3 flex items-center gap-2 font-space">
                        <Sparkles className="w-4 h-4 text-cyan-400" /> Selection Rationale
                      </h3>
                      <p className="text-sm text-slate-300 leading-relaxed font-outfit font-medium">{aiReport.selectionRationale}</p>
                    </div>

                    {/* Grid: Risk + Insights */}
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
                      <div className="rounded-2xl p-5 border border-rose-500/20 bg-rose-950/5 glow-rose">
                        <h3 className="text-xs font-extrabold text-rose-400 uppercase tracking-widest mb-3 font-space">Risk Assessment</h3>
                        <p className="text-xs text-slate-300 leading-relaxed font-medium">{aiReport.riskAssessment}</p>
                      </div>
                      <div className="rounded-2xl p-5 border border-purple-500/20 bg-purple-950/5 glow-violet">
                        <h3 className="text-xs font-extrabold text-purple-400 uppercase tracking-widest mb-3 font-space">Performance Insights</h3>
                        <p className="text-xs text-slate-300 leading-relaxed font-medium">{aiReport.performanceInsights}</p>
                      </div>
                    </div>

                    {/* Recommendations */}
                    {aiReport.recommendations.length > 0 && (
                      <div className="rounded-2xl p-5 border border-cyan-500/20 bg-cyan-950/5">
                        <h3 className="text-xs font-extrabold text-cyan-400 uppercase tracking-widest mb-4 font-space">AI Recommendations</h3>
                        <div className="space-y-3">
                          {aiReport.recommendations.map((rec, i) => (
                            <div key={i} className="flex items-start gap-3">
                              <span className="mt-0.5 w-5 h-5 rounded-lg bg-cyan-500/20 flex items-center justify-center flex-shrink-0 text-[10px] text-cyan-300 font-bold border border-cyan-500/30 font-jetbrains">{i + 1}</span>
                              <p className="text-xs text-slate-300 leading-relaxed font-medium">{rec}</p>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* Comparison Narrative */}
                    {decision.rankedNodes.length > 1 && (
                      <div className="rounded-2xl p-5 border border-violet-500/10 bg-violet-950/5">
                        <h3 className="text-xs font-extrabold text-violet-400 uppercase tracking-widest mb-3 font-space">Winner vs. Runner-Up</h3>
                        <p className="text-xs text-slate-300 leading-relaxed font-medium">{aiReport.comparisonNarrative}</p>
                      </div>
                    )}
                  </>
                )}

                {/* Positive facts always shown */}
                <div className="rounded-2xl p-5 border border-cyan-500/10 bg-slate-900/40">
                  <h3 className="text-xs font-extrabold text-cyan-400 uppercase tracking-widest mb-4 font-space">Contributing Factors</h3>
                  <div className="grid gap-2.5">
                    {decision.positiveFacts.map((fact, i) => (
                      <div key={i} className="flex items-center gap-3">
                        <CheckCircle className="w-4 h-4 text-cyan-400 flex-shrink-0" />
                        <span className="text-xs text-slate-300 font-medium">{fact}</span>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Winner score bars */}
                {winner && (
                  <div className="rounded-2xl p-6 border border-violet-500/15 bg-slate-900/40">
                    <h3 className="text-xs font-extrabold text-violet-400 uppercase tracking-widest mb-4 font-space">Score Breakdown — {winner.deviceName}</h3>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3.5">
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
              <div className="space-y-5">
                {/* Ranked nodes */}
                <div>
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-4 font-space">Ranked Candidates</h3>
                  <div className="space-y-3.5">
                    {decision.rankedNodes.map((node, idx) => (
                      <div
                        key={node.deviceId}
                        className={`rounded-2xl p-5 border transition-all duration-200 hover:scale-[1.005] ${
                          idx === 0
                            ? 'border-violet-500/35 bg-violet-950/15 glow-violet'
                            : 'border-slate-800/80 bg-slate-900/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-4 mb-4">
                          <div className="flex items-center gap-3">
                            {idx === 0
                              ? <Trophy className="w-5 h-5 text-violet-400 flex-shrink-0" />
                              : <span className="w-5 h-5 rounded-full bg-slate-800 flex items-center justify-center text-[10px] text-slate-400 font-bold flex-shrink-0 border border-slate-700">{idx + 1}</span>
                            }
                            <div>
                              <p className={`text-sm font-bold font-space ${idx === 0 ? 'text-violet-300' : 'text-slate-250'}`}>{node.deviceName}</p>
                              <p className="text-[10px] text-slate-500 font-mono mt-0.5">{node.deviceId.slice(0, 24)}…</p>
                            </div>
                          </div>
                          <div className="text-right flex-shrink-0">
                            <p className={`text-2xl font-black font-jetbrains tracking-tight ${scoreClass(node.finalScore)}`}>{node.finalScore.toFixed(2)}</p>
                            <p className="text-[9px] text-slate-500 font-bold uppercase tracking-wider">/ 100</p>
                          </div>
                        </div>

                        {/* Metric grid */}
                        <div className="grid grid-cols-3 md:grid-cols-6 gap-2.5">
                          {[
                            { label: 'CPU',      value: `${node.cpuUsage.toFixed(0)}%`,     icon: Cpu },
                            { label: 'RAM',      value: `${node.ramUsage.toFixed(0)}%`,     icon: MemoryStick },
                            { label: 'GPU',      value: `${node.gpuUsage.toFixed(0)}%`,     icon: Zap },
                            { label: 'CPU Temp', value: `${node.cpuTemp.toFixed(0)}°C`,     icon: Thermometer },
                            { label: 'Latency',  value: `${node.latencyMs.toFixed(0)}ms`,   icon: Wifi },
                            { label: 'Tasks',    value: `${node.runningTasks}/${node.waitingTasks}`, icon: ListTodo },
                          ].map(({ label, value, icon: Icon }) => (
                            <div key={label} className="rounded-xl p-3 bg-slate-950/60 text-center border border-slate-900/60">
                              <Icon className="w-3.5 h-3.5 text-slate-500 mx-auto mb-1" />
                              <p className="text-[9px] text-slate-550 font-bold uppercase tracking-wider">{label}</p>
                              <p className="text-xs text-slate-200 font-jetbrains font-bold mt-0.5">{value}</p>
                            </div>
                          ))}
                        </div>

                        {/* Score bars compact */}
                        <div className="mt-4 grid grid-cols-2 gap-2">
                          <ScoreBar value={node.cpuScore}         label="CPU"   icon={Cpu} />
                          <ScoreBar value={node.ramScore}         label="RAM"   icon={MemoryStick} />
                          <ScoreBar value={node.networkScore}     label="Net"   icon={Wifi} />
                          <ScoreBar value={node.diskScore}        label="Disk"  icon={HardDrive} />
                        </div>

                        {idx > 0 && node.eliminationReason && (
                          <p className="mt-3 text-[10px] text-slate-500 flex items-center gap-1.5 font-medium">
                            <XCircle className="w-3.5 h-3.5 text-rose-500" />
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
                    <h3 className="text-xs font-extrabold text-rose-400 uppercase tracking-widest mb-4 font-space">Eliminated Nodes</h3>
                    <div className="space-y-3">
                      {decision.eliminatedNodes.map(node => (
                        <div key={node.deviceId} className="rounded-2xl p-4 border border-rose-500/20 bg-rose-950/5 flex items-center gap-4 glow-rose">
                          <XCircle className="w-5 h-5 text-rose-400 flex-shrink-0" />
                          <div>
                            <p className="text-sm font-bold text-rose-300 font-space">{node.deviceName}</p>
                            <p className="text-xs text-rose-400/80 mt-0.5">{node.eliminationReason}</p>
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
              <div className="space-y-5">
                <div className="rounded-2xl p-5 border border-slate-800 bg-slate-900/40">
                  <h3 className="text-xs font-extrabold text-violet-400 uppercase tracking-widest mb-5 font-space">Active Scheduler Weights</h3>
                  <div className="space-y-4">
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
                        <Icon className="w-4 h-4 text-slate-500 flex-shrink-0" />
                        <span className="text-xs text-slate-300 w-44 flex-shrink-0 font-medium">{label}</span>
                        <div className="flex-1 bg-slate-950 rounded-full h-2 overflow-hidden border border-slate-900">
                          <div className="h-full rounded-full bg-gradient-to-r from-violet-600 to-cyan-500 shadow-[0_0_8px_rgba(6,182,212,0.4)]" style={{ width: `${w * 100}%` }} />
                        </div>
                        <span className="text-xs font-jetbrains font-bold text-cyan-400 w-12 text-right">{(w * 100).toFixed(0)}%</span>
                      </div>
                    ))}
                  </div>
                  <div className="mt-4 pt-4 border-t border-slate-800/80 flex items-center justify-between">
                    <span className="text-xs text-slate-500 font-bold uppercase tracking-wider">Total weight</span>
                    <span className="text-xs font-jetbrains font-bold text-cyan-400">
                      {(Object.values(decision.weights).reduce((a, b) => a + b, 0) * 100).toFixed(0)}%
                    </span>
                  </div>
                </div>

                {aiReport?.technicianNotes && (
                  <div className="rounded-2xl p-5 border border-slate-800 bg-slate-900/30">
                    <h3 className="text-xs font-extrabold text-slate-450 uppercase tracking-widest mb-3 font-space">Technician Notes</h3>
                    <p className="text-xs text-slate-400 leading-relaxed font-medium">{aiReport.technicianNotes}</p>
                  </div>
                )}

                <div className="rounded-2xl p-5 border border-slate-800 bg-slate-900/20">
                  <h3 className="text-xs font-extrabold text-slate-400 uppercase tracking-widest mb-4 font-space">Decision Metadata</h3>
                  <div className="grid grid-cols-2 gap-3">
                    {[
                      { label: 'Decision ID',    value: String(decision.timestamp) },
                      { label: 'Nodes Scored',   value: String(decision.totalConsidered) },
                      { label: 'Nodes Eliminated', value: String(decision.eliminatedNodes.length) },
                      { label: 'Tiebreaker',     value: decision.tiebroken ? (decision.tiebreakMethod ?? 'Yes') : 'None' },
                      { label: 'Confidence',     value: `${decision.confidence}%` },
                      { label: 'Score Margin',   value: decision.rankedNodes.length > 1 ? (decision.rankedNodes[0].finalScore - decision.rankedNodes[1].finalScore).toFixed(4) : 'N/A' },
                    ].map(({ label, value }) => (
                      <div key={label} className="rounded-xl p-3.5 bg-slate-950/60 border border-slate-900/60">
                        <p className="text-[10px] text-slate-500 mb-1 font-bold uppercase tracking-widest">{label}</p>
                        <p className="text-xs font-jetbrains text-slate-300 font-bold">{value}</p>
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
