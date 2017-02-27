/*
 * Copyright 2016-present, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the license found in the
 * LICENSE file in the root directory of this source tree.
 *
 */

/* jshint node: true, devel: true */
'use strict';

global.MY_SESSION = [];
global.GLOBAL_CONFIG = null;

const 
  bodyParser = require('body-parser'),
  config = require('config'),
  crypto = require('crypto'),
  express = require('express'),
  https = require('https'),  
  request = require('request'),
  myRequest = require('./my_modules/my_request'),
  myConfig = require('./my_modules/my_config');

var oauth;
var nforce = require('nforce');
var fs = require('fs');
var app = express();
var cookieParser = require('cookie-parser');
var MongoClient = require('mongodb').MongoClient;

app.set('port', process.env.PORT || 1107);
app.set('view engine', 'ejs');
app.use(bodyParser.json({ verify: verifyRequestSignature }));
app.use(bodyParser.urlencoded({ extended: true })); 
app.use(express.static('public'));

app.use(cookieParser());

MongoClient.connect('mongodb://mortgage-testv1.herokuapp:mortgage12345@ds145369.mlab.com:45369/mortgage-testv1-mongodb', function(err, db){
	if(err){console.log(err);return;}
	
	myConfig.configure(db, function(config){
		if(config){
			GLOBAL_CONFIG = config;
			myRequest.handleRequest(app, db);
		}
	});
	myRequest.handleConfigure(app, db);
});

// Start server
// Webhooks must be available via SSL with a certificate signed by a valid 
// certificate authority.
app.listen(app.get('port'), function() {
  console.log('Node app is running on port', app.get('port'));
});

module.exports = app;

