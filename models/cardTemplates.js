import { Mongo } from 'meteor/mongo';
import { SimpleSchema } from 'meteor/aldeed:simple-schema';

// 기본 템플릿 컬렉션
CardTemplates = new Mongo.Collection('card_templates');
// API 템플릿 컬렉션
ApiTemplates = new Mongo.Collection('api_templates');

// 기본 템플릿 스키마
CardTemplates.attachSchema(new SimpleSchema({
  title: {
    type: String,
  },
  url: {
    type: String,
    optional: true,
  },
  description: {
    type: String,
    optional: true,
  },
  enabled: {
    type: Boolean,
    defaultValue: true,
  },
  boardId: {
    type: String,
  },
  userId: {
    type: String,
  },
  createdAt: {
    type: Date,
  },
  modifiedAt: {
    type: Date,
    optional: true,
  }
}));

// API 템플릿 스키마
ApiTemplates.attachSchema(new SimpleSchema({
  parentTemplateId: {  // 부모 템플릿 ID
    type: String,
  },
  title: {
    type: String,
  },
  description: {
    type: String,
    optional: true,
  },
  boardId: {
    type: String,
  },
  userId: {
    type: String,
  },
  createdAt: {
    type: Date,
  },
  enabled: {
    type: Boolean,
    defaultValue: true,
  }
}));

// 권한 설정
if (Meteor.isServer) {
  CardTemplates.allow({
    insert(userId, doc) {
      return !!userId;
    },
    update(userId, doc) {
      return doc.userId === userId;
    },
    remove(userId, doc) {
      return doc.userId === userId;
    },
    fetch: ['userId'],
  });

  ApiTemplates.allow({
    insert(userId, doc) {
      return !!userId;
    },
    update(userId, doc) {
      return doc.userId === userId;
    },
    remove(userId, doc) {
      return doc.userId === userId;
    },
    fetch: ['userId'],
  });
}

export { CardTemplates, ApiTemplates };
