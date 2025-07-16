// require('dotenv').config(); // Not needed on Railway

// DEBUG: Check environment variables
console.log('=== DEBUG INFO ===');
console.log('TWILIO_ACCOUNT_SID:', process.env.TWILIO_ACCOUNT_SID);
console.log('TWILIO_AUTH_TOKEN:', process.env.TWILIO_AUTH_TOKEN ? 'SET' : 'NOT SET');
console.log('TWILIO_WHATSAPP_NUMBER:', process.env.TWILIO_WHATSAPP_NUMBER);
console.log('PORT:', process.env.PORT);
console.log('=== END DEBUG ===');
const express = require('express');
const twilio = require('twilio');

const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const TWILIO_ACCOUNT_SID = process.env.TWILIO_ACCOUNT_SID;
const TWILIO_AUTH_TOKEN = process.env.TWILIO_AUTH_TOKEN;
const TWILIO_WHATSAPP_NUMBER = process.env.TWILIO_WHATSAPP_NUMBER || 'whatsapp:+14155238886';
const PORT = process.env.PORT || 3000;

// Create Twilio client
const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);

// In-memory storage (temporary - will be replaced with database later)
const users = {};
const sales = {};
const inventory = {};

// Helper functions
function getUserData(phone) {
  if (!users[phone]) {
    users[phone] = {
      phone,
      businessName: null,
      isNew: true,
      created: new Date()
    };
  }
  return users[phone];
}

function getUserSales(phone) {
  if (!sales[phone]) {
    sales[phone] = [];
  }
  return sales[phone];
}

function getUserInventory(phone) {
  if (!inventory[phone]) {
    inventory[phone] = {};
  }
  return inventory[phone];
}

async function sendWhatsAppMessage(to, message) {
  try {
    await client.messages.create({
      body: message,
      from: TWILIO_WHATSAPP_NUMBER,
      to: to
    });
    console.log(`Message sent to ${to}`);
  } catch (error) {
    console.error('Error sending message:', error);
  }
}

// Parse sales messages
function parseSalesMessage(message) {
  const msg = message.toLowerCase();
  
  // Find amount
  let amount = 0;
  if (msg.includes('k')) {
    const match = msg.match(/(\d+)k/);
    if (match) amount = parseInt(match[1]) * 1000;
  } else {
    const match = msg.match(/(\d+)/);
    if (match) amount = parseInt(match[1]);
  }
  
  // Find quantity
  let quantity = 1;
  const quantityMatch = msg.match(/(\d+)\s*(pieces?|bags?|bottles?)/);
  if (quantityMatch) quantity = parseInt(quantityMatch[1]);
  
  // Find product
  let product = 'Item';
  if (msg.includes('sold')) {
    const match = msg.match(/sold\s+(.+?)\s+for/);
    if (match) product = match[1].trim();
  }
  
  return { product, amount, quantity };
}

// Parse inventory messages
function parseInventoryMessage(message) {
  const msg = message.toLowerCase();
  
  let quantity = 1;
  const quantityMatch = msg.match(/(\d+)/);
  if (quantityMatch) quantity = parseInt(quantityMatch[1]);
  
  let product = 'Item';
  if (msg.includes('add')) {
    const match = msg.match(/add\s+\d+\s+(.+)/);
    if (match) product = match[1].trim();
  }
  
  return { product, quantity };
}

// Main webhook
app.post('/webhook/whatsapp', async (req, res) => {
  const { From, Body } = req.body;
  const phone = From;
  const message = Body;
  
  console.log(`Message from ${phone}: ${message}`);
  
  try {
    const user = getUserData(phone);
    
    // Welcome new users
    if (user.isNew) {
      user.isNew = false;
      const welcomeMessage = `Welcome to Jummai! 👋

I help you track your business sales and inventory.

Try these:
💰 "I sold 2 shirts for 5k each"
📦 "Add 10 bags of rice"
📊 "Show sales this week"

What's your business name?`;
      
      await sendWhatsAppMessage(phone, welcomeMessage);
      res.status(200).send('OK');
      return;
    }
    
    // Handle business name
    if (!user.businessName && !message.toLowerCase().includes('sold') && !message.toLowerCase().includes('add')) {
      user.businessName = message.trim();
      
      const response = `Great! ${user.businessName} is now set up. 🎉

Try logging your first sale:
"I sold 2 shirts for 5k each"`;
      
      await sendWhatsAppMessage(phone, response);
      res.status(200).send('OK');
      return;
    }
    
    const msg = message.toLowerCase();
    let response = '';
    
    // Handle sales
    if (msg.includes('sold') || msg.includes('sell')) {
      const { product, amount, quantity } = parseSalesMessage(message);
      
      if (amount > 0) {
        const userSales = getUserSales(phone);
        const sale = {
          product,
          amount,
          quantity,
          timestamp: new Date()
        };
        userSales.push(sale);
        
        response = `✅ Sale recorded!
📝 Product: ${product}
💰 Amount: ₦${amount.toLocaleString()}
📊 Quantity: ${quantity}
📅 Time: ${new Date().toLocaleString()}

Total sales today: ${userSales.length}`;
      } else {
        response = `I couldn't understand the amount. Try: "I sold 2 shirts for 5k each"`;
      }
    }
    
    // Handle inventory
    else if (msg.includes('add') || msg.includes('restock')) {
      const { product, quantity } = parseInventoryMessage(message);
      const userInventory = getUserInventory(phone);
      
      if (!userInventory[product]) {
        userInventory[product] = 0;
      }
      userInventory[product] += quantity;
      
      response = `📦 Inventory updated!
🆕 Product: ${product}
📊 Current Stock: ${userInventory[product]}
📅 Updated: ${new Date().toLocaleString()}`;
    }
    
    // Handle reports
    else if (msg.includes('show') || msg.includes('report') || msg.includes('sales')) {
      const userSales = getUserSales(phone);
      const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const recentSales = userSales.filter(sale => new Date(sale.timestamp) >= weekAgo);
      const total = recentSales.reduce((sum, sale) => sum + sale.amount, 0);
      
      response = `📊 WEEKLY SALES REPORT
💰 Total Sales: ₦${total.toLocaleString()}
📈 Transactions: ${recentSales.length}
📅 Last 7 days

Recent sales:
${recentSales.slice(-5).map(sale => 
  `• ${sale.product}: ₦${sale.amount.toLocaleString()}`
).join('\n') || 'No sales yet'}`;
    }
    
    // Handle inventory check
    else if (msg.includes('inventory') || msg.includes('stock')) {
      const userInventory = getUserInventory(phone);
      const items = Object.keys(userInventory);
      
      if (items.length === 0) {
        response = `📦 No inventory items yet.
Try: "Add 10 bags of rice"`;
      } else {
        response = `📦 CURRENT INVENTORY:
${items.map(item => 
  `• ${item}: ${userInventory[item]} in stock`
).join('\n')}`;
      }
    }
    
    // Help
    else if (msg.includes('help')) {
      response = `🆘 JUMMAI HELP

💰 Record Sales:
"I sold 2 shirts for 5k each"

📦 Add Inventory:
"Add 10 bags of rice"

📊 View Reports:
"Show sales this week"

📦 Check Inventory:
"Show inventory"

🏪 Business: ${user.businessName || 'Not set'}
Need help? Just ask!`;
    }
    
    // Default response
    else {
      response = `I didn't understand that. Try:
💰 "I sold 2 shirts for 5k each"
📦 "Add 10 bags of rice"
📊 "Show sales this week"
❓ "help" for more commands`;
    }
    
    await sendWhatsAppMessage(phone, response);
    res.status(200).send('OK');
    
  } catch (error) {
    console.error('Error:', error);
    await sendWhatsAppMessage(phone, 'Sorry, something went wrong. Please try again.');
    res.status(500).send('Error');
  }
});

// Health check
app.get('/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date(),
    users: Object.keys(users).length,
    totalSales: Object.values(sales).reduce((sum, userSales) => sum + userSales.length, 0)
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Jummai server running on port ${PORT}`);
  console.log(`📱 Webhook URL: https://your-app.railway.app/webhook/whatsapp`);
  console.log(`🔍 Health check: http://localhost:${PORT}/health`);
});

module.exports = app;