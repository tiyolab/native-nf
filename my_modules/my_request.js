
exports.handleRequest = (app, db) => {
	/**
	 * This section for configuration only
	 * 
	 */
	app.get('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		collection.findOne({
			app_name: req.headers.host
		}, function(err, item){
			console.log('result');
			console.log(item);
		});
		console.log(req.headers.host);
		res.render('configure');
	});
	
}