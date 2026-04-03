var configDB = require('../config/database.js');
var mongoose = require('mongoose');

const databases = {
  test: 'test',
  main: 'main'
};

exports.databases = databases;

exports.connect = function (database) {
  if (mongoose.connection.readyState === 0) {
    mongoose.Promise = global.Promise;

    const useTestDb = process.env.NODE_ENV === 'test' || database === 'test';
    const targetUrl = useTestDb ? configDB.testUrl : configDB.url;
    mongoose.connect(targetUrl);
  }
};
