module.exports = (sequelize, DataTypes) => {
    const User = sequelize.define('User', {
        // Tentukan ID sebagai string
        id: {
            type: DataTypes.STRING,
            primaryKey: true,
            allowNull: false
        },
        username: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true
        },
        password: {
            type: DataTypes.STRING
        },
        role: {
            type: DataTypes.ENUM('user', 'admin'),
            defaultValue: 'user'
        }
    },{
        tableName: 'users',
        timestamps: true,
        sync :{force: false}
    });

    return User;
};