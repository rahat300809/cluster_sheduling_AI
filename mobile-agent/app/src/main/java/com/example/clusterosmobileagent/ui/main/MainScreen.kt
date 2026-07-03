package com.example.clusterosmobileagent.ui.main

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.viewmodel.compose.viewModel
import androidx.navigation3.runtime.NavKey

@Composable
fun MainScreen(
    onItemClick: (NavKey) -> Unit,
    modifier: Modifier = Modifier,
    viewModel: MainScreenViewModel = viewModel()
) {
    val deviceId by viewModel.deviceId.collectAsState()
    val pairCode by viewModel.pairCode.collectAsState()
    val isPaired by viewModel.isPaired.collectAsState()
    val isRentalEnabled by viewModel.isRentalEnabled.collectAsState()
    val isRented by viewModel.isRented.collectAsState()
    val renterEmail by viewModel.renterEmail.collectAsState()
    val timeRemaining by viewModel.timeRemaining.collectAsState()
    val earnedBalance by viewModel.earnedBalance.collectAsState()
    val consoleLogs by viewModel.consoleLogs.collectAsState()
    
    val cpuUsage by viewModel.cpuUsage.collectAsState()
    val ramUsage by viewModel.ramUsage.collectAsState()
    val batteryLevel by viewModel.batteryLevel.collectAsState()

    val darkBackground = Color(0xFF020617)
    val cardBackground = Color(0xFF0F172A)
    val textGreen = Color(0xFF22C55E)
    val textGray = Color(0xFF94A3B8)
    val textWhite = Color(0xFFF8FAFC)

    Column(
        modifier = modifier
            .fillMaxSize()
            .background(darkBackground)
            .padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        // Title block
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
            modifier = Modifier.fillMaxWidth()
        ) {
            Column {
                Text(
                    text = "ClusterOS Mobile",
                    color = textWhite,
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Bold
                )
                Text(
                    text = "Workload & Rental Host Agent",
                    color = textGray,
                    fontSize = 12.sp
                )
            }
            // Online status indicator
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(6.dp),
                modifier = Modifier
                    .background(Color(0xFF22C55E).copy(alpha = 0.1f), RoundedCornerShape(8.dp))
                    .padding(horizontal = 8.dp, vertical = 4.dp)
            ) {
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .background(Color(0xFF22C55E), RoundedCornerShape(4.dp))
                )
                Text("ONLINE", color = textGreen, fontSize = 10.sp, fontWeight = FontWeight.Bold)
            }
        }

        // Credentials Card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = cardBackground)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Text(
                    text = "DEVICE PAIRING STATE",
                    color = textGray,
                    fontSize = 11.sp,
                    fontWeight = FontWeight.Bold
                )

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween
                ) {
                    Column {
                        Text("Device Key", color = textGray, fontSize = 11.sp)
                        Text(deviceId, color = textWhite, fontSize = 16.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                    }
                    Column(horizontalAlignment = Alignment.End) {
                        Text("Pair Code", color = textGray, fontSize = 11.sp)
                        Text(pairCode, color = textGreen, fontSize = 16.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                    }
                }

                Divider(color = Color(0xFF1E293B))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text("Connection Status", color = textGray, fontSize = 12.sp)
                    Text(
                        text = if (isPaired) "✓ LINKED TO DASHBOARD" else "PENDING PAIRING...",
                        color = if (isPaired) textGreen else Color(0xFFF59E0B),
                        fontSize = 12.sp,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        }

        // Rental console switch card
        Card(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(16.dp),
            colors = CardDefaults.cardColors(containerColor = cardBackground)
        ) {
            Column(
                modifier = Modifier.padding(16.dp),
                verticalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Column {
                        Text(
                            text = "RENTAL HOSTING CONSOLE",
                            color = textGray,
                            fontSize = 11.sp,
                            fontWeight = FontWeight.Bold
                        )
                        Text(
                            text = "Rent out mobile hardware for cluster tasks",
                            color = textGray,
                            fontSize = 10.sp
                        )
                    }
                    Switch(
                        checked = isRentalEnabled,
                        onCheckedChange = { viewModel.toggleRental() },
                        colors = SwitchDefaults.colors(checkedThumbColor = textGreen, checkedTrackColor = textGreen.copy(alpha = 0.3f))
                    )
                }

                if (isRentalEnabled) {
                    Divider(color = Color(0xFF1E293B))

                    if (isRented) {
                        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text("Remaining Time:", color = textGray, fontSize = 12.sp)
                                Text(timeRemaining, color = Color(0xFFF59E0B), fontSize = 14.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                            }
                            Row(
                                modifier = Modifier.fillMaxWidth(),
                                horizontalArrangement = Arrangement.SpaceBetween
                            ) {
                                Text("Session Earnings:", color = textGray, fontSize = 12.sp)
                                Text(String.format("৳ %.2f Tk", earnedBalance), color = textGreen, fontSize = 14.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                            }
                        }
                    } else {
                        Text(
                            text = "Waiting for renters to initiate session...",
                            color = textGray,
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Medium
                        )
                    }
                }
            }
        }

        // Live Telemetry Stats
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.spacedBy(10.dp)
        ) {
            listOf(
                Triple("CPU Usage", "$cpuUsage%", textGreen),
                Triple("Memory Used", "$ramUsage%", textWhite),
                Triple("Battery", "$batteryLevel%", if (batteryLevel > 20) textGreen else Color(0xFFEF4444))
            ).forEach { (label, valStr, color) ->
                Box(
                    modifier = Modifier
                        .weight(1f)
                        .background(cardBackground, RoundedCornerShape(12.dp))
                        .padding(12.dp)
                ) {
                    Column {
                        Text(label, color = textGray, fontSize = 10.sp)
                        Text(valStr, color = color, fontSize = 18.sp, fontWeight = FontWeight.ExtraBold)
                    }
                }
            }
        }

        // Console logger
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(6.dp)
        ) {
            Text(
                text = "WORKLOAD CONSOLE OUTPUT LOGS",
                color = textGray,
                fontSize = 11.sp,
                fontWeight = FontWeight.Bold
            )
            LazyColumn(
                modifier = Modifier
                    .fillMaxSize()
                    .background(Color.Black, RoundedCornerShape(12.dp))
                    .border(1.dp, Color(0xFF1E293B), RoundedCornerShape(12.dp))
                    .padding(12.dp),
                verticalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                items(consoleLogs) { log ->
                    Text(
                        text = log,
                        color = if (log.contains("execution finished") || log.contains("successfully")) textGreen else textWhite,
                        fontSize = 11.sp,
                        fontFamily = FontFamily.Monospace
                    )
                }
            }
        }
    }
}
