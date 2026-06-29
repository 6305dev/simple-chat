const { Sequelize } = require('sequelize');
require('dotenv').config();

// Buat instance Sequelize dengan konfigurasi dari .env
const sequelize = new Sequelize(
    process.env.DB_NAME,
    process.env.DB_USER,
    process.env.DB_PASS,
    {
        host: process.env.DB_HOST,
        dialect: 'mysql',
        logging: false
    }
);

const User = require('./User')(sequelize, Sequelize.DataTypes);
const Message = require('./Message')(sequelize, Sequelize.DataTypes);

// Definisikan relasi (associations)
User.hasMany(Message, { foreignKey: 'senderId', as: 'sentMessages' });
User.hasMany(Message, { foreignKey: 'receiverId', as: 'receivedMessages' });
Message.belongsTo(User, { foreignKey: 'senderId', as: 'sender' });
Message.belongsTo(User, { foreignKey: 'receiverId', as: 'receiver' });

const db = {
    sequelize,
    Sequelize,
    User,
    Message
};

module.exports = db;