package com.example.clusterosmobileagent.ui.main

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import com.example.clusterosmobileagent.service.AgentService
import kotlinx.coroutines.flow.StateFlow

class MainScreenViewModel(application: Application) : AndroidViewModel(application) {
    private val context = application.applicationContext

    val deviceId: StateFlow<String> = AgentService.deviceId
    val pairCode: StateFlow<String> = AgentService.pairCode
    val isPaired: StateFlow<Boolean> = AgentService.isPaired
    val isRentalEnabled: StateFlow<Boolean> = AgentService.isRentalEnabled
    val isRented: StateFlow<Boolean> = AgentService.isRented
    val renterEmail: StateFlow<String> = AgentService.renterEmail
    val timeRemaining: StateFlow<String> = AgentService.timeRemaining
    val earnedBalance: StateFlow<Double> = AgentService.earnedBalance
    val consoleLogs: StateFlow<List<String>> = AgentService.consoleLogs
    val cpuUsage: StateFlow<Int> = AgentService.cpuUsage
    val ramUsage: StateFlow<Int> = AgentService.ramUsage
    val batteryLevel: StateFlow<Int> = AgentService.batteryLevel

    fun toggleRental() {
        val nextVal = !AgentService.isRentalEnabled.value
        AgentService._isRentalEnabled.value = nextVal
        context.getSharedPreferences("mobile_agent_prefs", Context.MODE_PRIVATE)
            .edit()
            .putBoolean("rental_enabled", nextVal)
            .apply()
        AgentService.log("Rental hosting " + (if (nextVal) "ENABLED" else "DISABLED"))
    }
}
