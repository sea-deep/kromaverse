require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const mongoose = require('mongoose');
const User = require('./models/User');
const Pixel = require('./models/Pixel');

const MONGO = process.env.MONGO || 'mongodb://localhost:27017/kromaverse';

async function purgeDatabase() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(MONGO);
    console.log('✓ Connected to MongoDB');
    
    console.log('\nPurging database...');
    
    const userCount = await User.countDocuments();
    const pixelCount = await Pixel.countDocuments();
    
    console.log(`Found ${userCount} users and ${pixelCount} pixels`);
    
    if (userCount === 0 && pixelCount === 0) {
      console.log('Database is already empty!');
      process.exit(0);
    }
    
    // Delete all users
    await User.deleteMany({});
    console.log(`✓ Deleted ${userCount} users`);
    
    // Delete all pixels
    await Pixel.deleteMany({});
    console.log(`✓ Deleted ${pixelCount} pixels`);
    
    console.log('\n🎉 Database purged successfully!');
    console.log('Canvas is now blank and all users are removed.');
    
  } catch (error) {
    console.error('✗ Error purging database:', error);
    process.exit(1);
  } finally {
    await mongoose.connection.close();
    process.exit(0);
  }
}

purgeDatabase();
