import {DataTypes, Model} from 'sequelize';
class Reaction extends Model {

    static init(sequelize, DataTypes) {
        super.init({
            reactionId: {
                type: DataTypes.STRING,
                allowNull: false,
                primaryKey: true,
            },
            postId: {
                type: DataTypes.STRING,
                allowNull: false,
            },
            timestamp: {
                type: DataTypes.DATE,
                allowNull: false,
            },
        }, {
            sequelize,
            modelName: 'Reaction',
        });
    }
    static associate(models) {
        // Define associations here
        Reaction.belongsTo(models.Post, {
            foreignKey: 'postId',
            as: 'post',
        });
    }
}

export { Reaction }