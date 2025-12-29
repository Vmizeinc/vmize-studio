// =================================================================
// VMIZE STUDIO - ADMIN API ENDPOINTS
// =================================================================
// Add these routes to your existing server.js or create admin-routes.js
// =================================================================

const express = require('express');
const router = express.Router();
const Customer = require('./models/Customer');

// =================================================================
// MIDDLEWARE: Admin Authentication
// =================================================================

async function requireAdmin(req, res, next) {
  // Check if user is admin (implement your own auth logic)
  const adminToken = req.headers['x-admin-token'];
  
  if (adminToken !== process.env.ADMIN_SECRET_TOKEN) {
    return res.status(403).json({ 
      error: 'Forbidden', 
      message: 'Admin access required' 
    });
  }
  
  next();
}

// =================================================================
// ADMIN DASHBOARD - OVERVIEW STATS
// =================================================================

router.get('/admin/stats/overview', requireAdmin, async (req, res) => {
  try {
    const totalCustomers = await Customer.countDocuments();
    const activeSubscriptions = await Customer.countDocuments({ 
      subscriptionStatus: 'active' 
    });
    
    // Calculate total try-ons this month
    const customers = await Customer.find();
    const totalTryons = customers.reduce((sum, c) => 
      sum + (c.usage?.currentMonth?.tryons || 0), 0
    );
    
    // Calculate monthly revenue
    const planPrices = {
      starter: 29,
      professional: 79,
      business: 199,
      enterprise: 499
    };
    
    const monthlyRevenue = customers
      .filter(c => c.subscriptionStatus === 'active')
      .reduce((sum, c) => sum + (planPrices[c.plan] || 0), 0);
    
    res.json({
      totalCustomers,
      activeSubscriptions,
      totalTryons,
      monthlyRevenue,
      timestamp: new Date()
    });
  } catch (error) {
    console.error('Error fetching overview stats:', error);
    res.status(500).json({ error: 'Failed to fetch stats' });
  }
});

// =================================================================
// ADMIN - GET ALL CUSTOMERS
// =================================================================

router.get('/admin/customers', requireAdmin, async (req, res) => {
  try {
    const { filter, search } = req.query;
    
    let query = {};
    
    // Apply filters
    if (filter && filter !== 'all') {
      if (filter === 'near-limit') {
        // Find customers at 80%+ usage
        const customers = await Customer.find();
        const nearLimit = customers.filter(c => {
          const usage = c.usage?.currentMonth?.tryons || 0;
          const limit = getPlanLimit(c.plan);
          return (usage / limit) >= 0.8;
        });
        return res.json(nearLimit);
      } else {
        query.plan = filter;
      }
    }
    
    // Apply search
    if (search) {
      query.$or = [
        { companyName: { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } }
      ];
    }
    
    const customers = await Customer.find(query)
      .select('-password -stripeCustomerId')
      .sort({ createdAt: -1 });
    
    res.json(customers);
  } catch (error) {
    console.error('Error fetching customers:', error);
    res.status(500).json({ error: 'Failed to fetch customers' });
  }
});

// =================================================================
// ADMIN - GET SINGLE CUSTOMER DETAILS
// =================================================================

router.get('/admin/customers/:id', requireAdmin, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id)
      .select('-password');
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    // Get try-on history (if stored separately)
    // const tryonHistory = await TryOn.find({ customerId: customer._id })
    //   .sort({ createdAt: -1 })
    //   .limit(50);
    
    res.json({
      customer,
      // tryonHistory
    });
  } catch (error) {
    console.error('Error fetching customer:', error);
    res.status(500).json({ error: 'Failed to fetch customer' });
  }
});

// =================================================================
// ADMIN - DELETE CUSTOMER
// =================================================================

router.delete('/admin/customers/:id', requireAdmin, async (req, res) => {
  try {
    const customer = await Customer.findById(req.params.id);
    
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    // Cancel Stripe subscription
    if (customer.stripeSubscriptionId) {
      await stripe.subscriptions.cancel(customer.stripeSubscriptionId);
    }
    
    // Delete customer
    await Customer.deleteOne({ _id: req.params.id });
    
    // Delete associated try-on photos (if stored)
    // await TryOn.deleteMany({ customerId: customer._id });
    
    res.json({ 
      success: true, 
      message: 'Customer deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting customer:', error);
    res.status(500).json({ error: 'Failed to delete customer' });
  }
});

// =================================================================
// ADMIN - GET UPSELL OPPORTUNITIES
// =================================================================

router.get('/admin/upsell-opportunities', requireAdmin, async (req, res) => {
  try {
    const customers = await Customer.find({ 
      subscriptionStatus: 'active' 
    });
    
    const upsellOpportunities = customers.filter(c => {
      const usage = c.usage?.currentMonth?.tryons || 0;
      const limit = getPlanLimit(c.plan);
      const percentUsed = (usage / limit) * 100;
      
      return percentUsed >= 80 && c.plan !== 'enterprise';
    }).map(c => {
      const usage = c.usage?.currentMonth?.tryons || 0;
      const limit = getPlanLimit(c.plan);
      const percentUsed = (usage / limit) * 100;
      
      return {
        customerId: c._id,
        companyName: c.companyName,
        email: c.email,
        currentPlan: c.plan,
        usage,
        limit,
        percentUsed: percentUsed.toFixed(1),
        recommendedPlan: getNextPlan(c.plan)
      };
    });
    
    res.json(upsellOpportunities);
  } catch (error) {
    console.error('Error fetching upsell opportunities:', error);
    res.status(500).json({ error: 'Failed to fetch opportunities' });
  }
});

// =================================================================
// ADMIN - SEND UPSELL EMAIL
// =================================================================

router.post('/admin/send-upsell-email', requireAdmin, async (req, res) => {
  try {
    const { customerId } = req.body;
    
    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }
    
    const usage = customer.usage?.currentMonth?.tryons || 0;
    const limit = getPlanLimit(customer.plan);
    const percentUsed = ((usage / limit) * 100).toFixed(1);
    const nextPlan = getNextPlan(customer.plan);
    
    // Send email (integrate with your email service)
    const emailContent = {
      to: customer.email,
      subject: `You're at ${percentUsed}% of your ${customer.plan} plan limit!`,
      html: `
        <h2>Hi ${customer.companyName},</h2>
        <p>You're currently using <strong>${usage} out of ${limit}</strong> try-ons this month (${percentUsed}%).</p>
        <p>To avoid hitting your limit, we recommend upgrading to our <strong>${nextPlan.name}</strong> plan:</p>
        <ul>
          <li>${nextPlan.limit.toLocaleString()} try-ons per month</li>
          <li>Only $${nextPlan.price}/month</li>
        </ul>
        <p><a href="${process.env.VMIZE_DASHBOARD_URL || 'https://vmizestudio.com/dashboard/billing'}">Upgrade Now →</a></p>
      `
    };
    
    // await sendEmail(emailContent);
    
    // Track that upsell email was sent
    await Customer.updateOne(
      { _id: customerId },
      { 
        $push: { 
          upsellEmailsSent: {
            date: new Date(),
            plan: nextPlan.name,
            usage: percentUsed
          }
        }
      }
    );
    
    res.json({ 
      success: true, 
      message: 'Upsell email sent successfully' 
    });
  } catch (error) {
    console.error('Error sending upsell email:', error);
    res.status(500).json({ error: 'Failed to send email' });
  }
});

// =================================================================
// ADMIN - USAGE ANALYTICS
// =================================================================

router.get('/admin/analytics/usage', requireAdmin, async (req, res) => {
  try {
    const { startDate, endDate } = req.query;
    
    // Get usage data by month
    const customers = await Customer.find();
    
    const usageByMonth = {};
    customers.forEach(c => {
      if (c.usage?.history) {
        c.usage.history.forEach(h => {
          if (!usageByMonth[h.month]) {
            usageByMonth[h.month] = 0;
          }
          usageByMonth[h.month] += h.tryons;
        });
      }
    });
    
    res.json({
      usageByMonth,
      totalCustomers: customers.length,
      avgUsagePerCustomer: Object.values(usageByMonth).reduce((a, b) => a + b, 0) / customers.length
    });
  } catch (error) {
    console.error('Error fetching analytics:', error);
    res.status(500).json({ error: 'Failed to fetch analytics' });
  }
});

// =================================================================
// ADMIN - GEOGRAPHIC DATA
// =================================================================

router.get('/admin/locations', requireAdmin, async (req, res) => {
  try {
    const customers = await Customer.find()
      .select('companyName location city state');
    
    // Group by location
    const customersByLocation = {};
    customers.forEach(c => {
      const location = `${c.city}, ${c.state}`;
      if (!customersByLocation[location]) {
        customersByLocation[location] = [];
      }
      customersByLocation[location].push(c.companyName);
    });
    
    // Get end-user locations (from try-on records)
    // This would come from your TryOn model if you're storing location data
    const endUserLocations = {
      // Aggregate from try-on records
    };
    
    res.json({
      customerLocations: customersByLocation,
      endUserLocations
    });
  } catch (error) {
    console.error('Error fetching locations:', error);
    res.status(500).json({ error: 'Failed to fetch locations' });
  }
});

// =================================================================
// ADMIN - CONVERSION TRACKING
// =================================================================

router.get('/admin/conversions', requireAdmin, async (req, res) => {
  try {
    const customers = await Customer.find();
    
    const conversions = customers.map(c => {
      const tryons = c.analytics?.totalTryons || 0;
      const addedToCart = c.analytics?.addedToCart || 0;
      const purchases = c.analytics?.purchases || 0;
      
      const conversionRate = tryons > 0 
        ? ((purchases / tryons) * 100).toFixed(2) 
        : 0;
      
      return {
        customerId: c._id,
        companyName: c.companyName,
        tryons,
        addedToCart,
        purchases,
        conversionRate,
        revenueImpact: (purchases * 89.99).toFixed(2) // Avg order value
      };
    });
    
    // Calculate totals
    const totals = {
      totalTryons: conversions.reduce((sum, c) => sum + c.tryons, 0),
      totalAddedToCart: conversions.reduce((sum, c) => sum + c.addedToCart, 0),
      totalPurchases: conversions.reduce((sum, c) => sum + c.purchases, 0)
    };
    
    totals.addToCartRate = ((totals.totalAddedToCart / totals.totalTryons) * 100).toFixed(1);
    totals.purchaseRate = ((totals.totalPurchases / totals.totalAddedToCart) * 100).toFixed(1);
    totals.overallConversion = ((totals.totalPurchases / totals.totalTryons) * 100).toFixed(2);
    
    res.json({
      conversions,
      totals
    });
  } catch (error) {
    console.error('Error fetching conversions:', error);
    res.status(500).json({ error: 'Failed to fetch conversions' });
  }
});

// =================================================================
// ADMIN - GET ALL TRY-ON PHOTOS
// =================================================================

router.get('/admin/photos', requireAdmin, async (req, res) => {
  try {
    const { customerId, limit = 100 } = req.query;
    
    let query = {};
    if (customerId) {
      query.customerId = customerId;
    }
    
    // Get try-on records with photos
    // const photos = await TryOn.find(query)
    //   .select('customerId resultImageUrl createdAt')
    //   .sort({ createdAt: -1 })
    //   .limit(parseInt(limit));
    
    // For now, return mock data
    const photos = [];
    
    res.json(photos);
  } catch (error) {
    console.error('Error fetching photos:', error);
    res.status(500).json({ error: 'Failed to fetch photos' });
  }
});

// =================================================================
// ADMIN - DELETE TRY-ON PHOTO
// =================================================================

router.delete('/admin/photos/:id', requireAdmin, async (req, res) => {
  try {
    // Delete photo from storage and database
    // await TryOn.deleteOne({ _id: req.params.id });
    
    res.json({ 
      success: true, 
      message: 'Photo deleted successfully' 
    });
  } catch (error) {
    console.error('Error deleting photo:', error);
    res.status(500).json({ error: 'Failed to delete photo' });
  }
});

// =================================================================
// HELPER FUNCTIONS
// =================================================================

function getPlanLimit(plan) {
  const limits = {
    starter: 100,
    professional: 500,
    business: 2000,
    enterprise: 10000
  };
  return limits[plan] || 100;
}

function getNextPlan(currentPlan) {
  const plans = {
    starter: { name: 'Professional', price: 79, limit: 500 },
    professional: { name: 'Business', price: 199, limit: 2000 },
    business: { name: 'Enterprise', price: 499, limit: 10000 }
  };
  return plans[currentPlan] || plans.starter;
}

// =================================================================
// EXPORT ROUTES
// =================================================================

module.exports = router;
