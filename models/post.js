import {Model} from "sequelize";

class Post extends Model {
    static init(sequelize, DataTypes) {
        super.init({
            postId: {
                type: DataTypes.STRING,
                allowNull: false,
                primaryKey: true,
            },
        }, {
            sequelize,
            modelName: 'Post',
        });
    }

    static associate(models) {
        // Define associations here
        Post.hasMany(models.Reaction, {
            foreignKey: 'postId',
            as: 'reactions',
        });
    }
}

export { Post }