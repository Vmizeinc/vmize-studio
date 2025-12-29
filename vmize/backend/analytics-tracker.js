/**
 * Vmize Analytics Tracker
 * Real-time API usage tracking and analytics
 */

const fs = require('fs').promises;
const path = require('path');

class AnalyticsTracker {
    constructor() {
        this.dataFile = path.join(__dirname, 'analytics-data.json');
        this.data = {
            apiCalls: [],
            customers: {},
            dailyStats: {},
            eventCounts: {
                tryon_initiated: 0,
                photo_uploaded: 0,
                result_generated: 0,
                result_viewed: 0,
                add_to_cart: 0,
                purchase: 0,
                api_error: 0
            },
            revenue: 0,
            startDate: new Date().toISOString()
        };
        this.loadData();
    }

    async loadData() {
        try {
            const fileData = await fs.readFile(this.dataFile, 'utf8');
                this.data = JSON.parse(fileData);
                // Restore Set for uniqueCustomers in dailyStats
                if (this.data.dailyStats) {
                    for (const dateKey of Object.keys(this.data.dailyStats)) {
                        const day = this.data.dailyStats[dateKey];
                        if (day && day.uniqueCustomers && !(day.uniqueCustomers instanceof Set)) {
                            day.uniqueCustomers = new Set(day.uniqueCustomers);
                        }
                    }
                }
                console.log('📊 Analytics data loaded');
        } catch (error) {
            console.log('📊 Starting fresh analytics tracking');
            await this.saveData();
        }
    }

    async saveData() {
        try {
            await fs.writeFile(this.dataFile, JSON.stringify(this.data, null, 2));
        } catch (error) {
            console.error('❌ Error saving analytics:', error);
        }
    }

    // Track API Call
    async trackApiCall(data) {
        const timestamp = new Date();
        const dateKey = timestamp.toISOString().split('T')[0];
        
        const apiCall = {
            id: `call_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
            customerId: data.customerId || 'unknown',
            apiKey: data.apiKey,
            endpoint: data.endpoint,
            method: data.method,
            status: data.status,
            duration: data.duration,
            timestamp: timestamp.toISOString(),
            productId: data.productId,
            error: data.error
        };

        // Store API call
        this.data.apiCalls.push(apiCall);

        // Update customer stats
        if (!this.data.customers[data.customerId]) {
            this.data.customers[data.customerId] = {
                totalCalls: 0,
                successfulCalls: 0,
                failedCalls: 0,
                totalDuration: 0,
                firstSeen: timestamp.toISOString(),
                lastSeen: timestamp.toISOString(),
                revenue: 0
            };
        }

        const customer = this.data.customers[data.customerId];
        customer.totalCalls++;
        customer.totalDuration += data.duration;
        customer.lastSeen = timestamp.toISOString();

        if (data.status === 'success' || data.status === 200) {
            customer.successfulCalls++;
        } else {
            customer.failedCalls++;
        }

        // Update daily stats
        if (!this.data.dailyStats[dateKey]) {
            this.data.dailyStats[dateKey] = {
                totalCalls: 0,
                successfulCalls: 0,
                failedCalls: 0,
                uniqueCustomers: new Set(),
                revenue: 0
            };
        }

        this.data.dailyStats[dateKey].totalCalls++;
        this.data.dailyStats[dateKey].uniqueCustomers.add(data.customerId);

        if (data.status === 'success' || data.status === 200) {
            this.data.dailyStats[dateKey].successfulCalls++;
        } else {
            this.data.dailyStats[dateKey].failedCalls++;
        }

        await this.saveData();
        
        console.log(`📊 Tracked: ${data.endpoint} for ${data.customerId} - ${data.status}`);
        
        return apiCall;
    }

    // Track Event
    async trackEvent(eventName, data = {}) {
        const timestamp = new Date();
        const dateKey = timestamp.toISOString().split('T')[0];

        // Increment event count
        if (this.data.eventCounts[eventName] !== undefined) {
            this.data.eventCounts[eventName]++;
        } else {
            this.data.eventCounts[eventName] = 1;
        }

        // Track revenue
        if (data.revenue) {
            this.data.revenue += data.revenue;
            
            if (data.customerId && this.data.customers[data.customerId]) {
                this.data.customers[data.customerId].revenue += data.revenue;
            }

            if (this.data.dailyStats[dateKey]) {
                this.data.dailyStats[dateKey].revenue += data.revenue;
            }
        }

        await this.saveData();
        
        console.log(`📊 Event tracked: ${eventName}`, data);
    }

    // Get Analytics Summary
    getAnalyticsSummary() {
        const last30Days = this.getLast30DaysData();
        const totalCalls = this.data.apiCalls.length;
        const uniqueCustomers = Object.keys(this.data.customers).length;
        
        let successfulCalls = 0;
        let totalDuration = 0;

        this.data.apiCalls.forEach(call => {
            if (call.status === 'success' || call.status === 200) {
                successfulCalls++;
            }
            totalDuration += call.duration || 0;
        });

        const successRate = totalCalls > 0 ? (successfulCalls / totalCalls * 100).toFixed(2) : 0;
        const avgDuration = totalCalls > 0 ? (totalDuration / totalCalls).toFixed(2) : 0;

        return {
            totalApiCalls: totalCalls,
            uniqueCustomers,
            successRate: `${successRate}%`,
            avgResponseTime: `${avgDuration}ms`,
            totalRevenue: this.data.revenue.toFixed(2),
            eventCounts: this.data.eventCounts,
            last30Days,
            topCustomers: this.getTopCustomers(5),
            recentCalls: this.data.apiCalls.slice(-10).reverse()
        };
    }

    // Get Last 30 Days Data
    getLast30DaysData() {
        const days = [];
        const now = new Date();
        
        for (let i = 29; i >= 0; i--) {
            const date = new Date(now);
            date.setDate(date.getDate() - i);
            const dateKey = date.toISOString().split('T')[0];
            
            const dayData = this.data.dailyStats[dateKey];
            
            days.push({
                date: dateKey,
                calls: dayData?.totalCalls || 0,
                successful: dayData?.successfulCalls || 0,
                failed: dayData?.failedCalls || 0,
                customers: dayData?.uniqueCustomers?.size || 0,
                revenue: dayData?.revenue || 0
            });
        }
        
        return days;
    }

    // Get Top Customers
    getTopCustomers(limit = 5) {
        return Object.entries(this.data.customers)
            .map(([id, data]) => ({
                customerId: id,
                ...data,
                successRate: data.totalCalls > 0 
                    ? (data.successfulCalls / data.totalCalls * 100).toFixed(2) + '%'
                    : '0%'
            }))
            .sort((a, b) => b.totalCalls - a.totalCalls)
            .slice(0, limit);
    }

    // Get Conversion Funnel
    getConversionFunnel() {
        const events = this.data.eventCounts;
        
        return {
            productView: events.tryon_initiated || 0,
            tryonClick: events.tryon_initiated || 0,
            photoUpload: events.photo_uploaded || 0,
            resultViewed: events.result_viewed || 0,
            addToCart: events.add_to_cart || 0,
            purchase: events.purchase || 0,
            
            // Conversion rates
            uploadRate: this.calculateRate(events.photo_uploaded, events.tryon_initiated),
            viewRate: this.calculateRate(events.result_viewed, events.photo_uploaded),
            cartRate: this.calculateRate(events.add_to_cart, events.result_viewed),
            purchaseRate: this.calculateRate(events.purchase, events.add_to_cart)
        };
    }

    calculateRate(numerator, denominator) {
        if (!denominator || denominator === 0) return '0%';
        return ((numerator / denominator) * 100).toFixed(1) + '%';
    }

    // Reset Analytics (for testing)
    async reset() {
        this.data = {
            apiCalls: [],
            customers: {},
            dailyStats: {},
            eventCounts: {
                tryon_initiated: 0,
                photo_uploaded: 0,
                result_generated: 0,
                result_viewed: 0,
                add_to_cart: 0,
                purchase: 0,
                api_error: 0
            },
            revenue: 0,
            startDate: new Date().toISOString()
        };
        await this.saveData();
        console.log('📊 Analytics reset');
    }
}

module.exports = AnalyticsTracker;
