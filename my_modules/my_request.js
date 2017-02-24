
exports.handleRequest = (app, db) => {
	/**
	 * This section for configuration only
	 * 
	 */
	app.get('/configure', function(req, res){
		var collection = db.collection('app_configuration');
		collection.findOne({
			host: req.headers.host
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
		if(data.status_record === 'new'){
			collection.insert(data, {w:1}, function(err, result){
				if(err) data['status']= 0;
				else data['status']= 0;
				res.render('configure_change', data);
			});
		}else if(data.status_record === 'old'){
			
		}
	});
}