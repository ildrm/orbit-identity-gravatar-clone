<?php
if(PHP_SAPI!=='cli')exit(1);
$dir=$argv[1];
file_put_contents($dir.'/openssl.cnf',"[req]\ndistinguished_name=dn\n[dn]\n[v3]\nbasicConstraints=critical,CA:TRUE\nsubjectAltName=IP:11.255.254.44\nkeyUsage=digitalSignature,keyEncipherment,keyCertSign\n");
$options=array('config'=>$dir.'/openssl.cnf','digest_alg'=>'sha256','private_key_bits'=>2048,'private_key_type'=>OPENSSL_KEYTYPE_RSA);
$key=openssl_pkey_new($options);$csr=openssl_csr_new(array('commonName'=>'Orbit fault fixture'),$key,$options);
$cert=openssl_csr_sign($csr,null,$key,2,$options+array('x509_extensions'=>'v3'));
if(!$cert||!openssl_pkey_export($key,$pem,null,$options))throw new RuntimeException('Fixture certificate failed.');
file_put_contents($dir.'/key.pem',$pem);openssl_x509_export_to_file($cert,$dir.'/cert.pem');
