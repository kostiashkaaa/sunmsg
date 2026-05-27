from flask_wtf import FlaskForm
from wtforms import StringField, SubmitField, HiddenField, BooleanField
from wtforms.validators import DataRequired, Length, Optional

class RegistrationForm(FlaskForm):
    action = HiddenField('Action', default='register')
    username = StringField('Имя пользователя', validators=[DataRequired(), Length(min=2, max=50)])
    display_name = StringField('Отображаемое имя', validators=[Optional(), Length(max=50)])
    submit = SubmitField('Зарегистрироваться')

class LoginForm(FlaskForm):
    action = HiddenField('Action', default='login')
    username = StringField('Имя пользователя', validators=[DataRequired(), Length(min=1, max=50)])
    private_key = StringField('Ваш приватный ключ (без заголовков и окончаний)', validators=[DataRequired()])
    submit = SubmitField('Войти')

class SettingsForm(FlaskForm):
    username = StringField('Имя пользователя', validators=[DataRequired(), Length(min=1, max=50)])
    display_name = StringField('Отображаемое имя', validators=[DataRequired(), Length(min=1, max=50)])
    is_public = BooleanField('Публичный профиль')
    auto_decline_requests = BooleanField('Автоматически отклонять запросы на диалог')
    hide_online_status = BooleanField('Скрыть статус онлайн')
    reset_keys = BooleanField('Сбросить ключи')
    submit = SubmitField('Сохранить настройки')
