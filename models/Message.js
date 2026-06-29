module.exports = (sequelize, DataTypes) => {
    const Message = sequelize.define('Message', {
        senderId: {
            type: DataTypes.STRING,
            allowNull: false
        },
        receiverId: {
            type: DataTypes.STRING,
            allowNull: true
        },
        content: {
            type: DataTypes.TEXT,
            allowNull: true
        },
        imageUrl: {
            type: DataTypes.STRING,
            allowNull: true
        },
        isForAdmin: {
            type: DataTypes.BOOLEAN,
            defaultValue: false
        },
        // --- BARU: Tambahkan kolom untuk melacak status pesan ---
        isRead: {
            type: DataTypes.BOOLEAN,
            defaultValue: false // Pesan baru secara default belum dibaca
        }
    },{
        tableName: 'messages',
        timestamps: true,
        sync :{force: false}
    });

    return Message;
};