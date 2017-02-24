"use strict";

let os = require('os');
let _package = require('../package.json');
exports.handleConfigure = (app, db, globalConfig) => {
	/**
	 * This section for configuration only
	 * 
	 */
	app.get('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		collection.findOne({
			my_app_name: _package.name
		}, function(err, item){
			if(item){
				item['status'] = -1;
				res.render('configure_change', item);
			}else{
				res.render('configure');
			}
		});
	});
	
	app.post('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		var data = req.body;
		
		data['host'] = req.headers.host;
		data['my_app_name'] = _package.name;
		
		if(data.status_record === 'new'){
			collection.insert(data, {w:1}, function(err, result){
				if(err){
					data['status']= 0;
				}else{
					data['status']= 1;
				}
				res.render('configure_change', data);
			});
		}else if(data.status_record === 'old'){
			collection.update({my_app_name: _package.name}, {$set: data}, {w:1}, function(err, result){
				if(err){
					data['status']= 0;
				}else {
					data['status']= 1;
				}
				res.render('configure_change', data);
			});
		}
		
		globalConfig = data;
	});
}

exports.handleRequest = (app, db, config) => {
	console.log('consumer key');
	console.log(config.salesforce_app.consumer_key);
};